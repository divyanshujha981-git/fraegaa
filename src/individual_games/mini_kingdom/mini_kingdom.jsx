import  { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, increment, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import html2canvas from "html2canvas";
import { firestore } from "../../firebase";
import {deleteSession, readDeviceId} from "../../other_assets/helpers/methods.jsx";
import {ID, MINI_KINGDOM, PLAYERS_INFO} from "../../other_assets/helpers/constants.jsx";
import './mini_kingdom.css';


/*
    HOW THE GAME WORKS
    - Paused until all 4 players have joined.
    - The host taps the flask to shake it, then every player taps it to draw one card
      (king / queen / thief / police). Drawing a card does:  score += POSITION.value
    - The police picks who they think the thief is.
        correct -> police: score += police.value   thief: score -= thief.reduce
        wrong   -> police: score -= police.reduce  thief: score += thief.value
    - The host moves on to the next round; after the last round the winner is shown,
      players can save the result as an image, and the session is deleted from Firestore.

    FIRESTORE
    miniKingdom/{gameId}
        totalRound, currentRound                              (from the spec)
        hostId     deviceId of the host
        phase      'shake' | 'pick' | 'guess' | 'result' | 'finished'
        deck       cards still in the flask during 'pick'
        guessId    deviceId the police accused (set in 'result')
        playersInfo/{deviceId}
            name, avatar, deviceId, score, currentPosition (0..3, or -1 = no position)
*/

export const POSITIONS = [
    {position: "king", value: 500, reduce: 0},
    {position: "queen", value: 300, reduce: 0},
    {position: "thief", value: 400, reduce: 400},
    {position: "police", value: 200, reduce: 300},
];

export const PLAYER_COUNT = POSITIONS.length;
export const GAME_COLLECTION = MINI_KINGDOM;

// !! adjust these two to match your router
export const GAME_ROUTE = '/minikingdom';
export const PREGAME_ROUTE = '/minikingdom/pregame_definition';

const POLICE = POSITIONS.findIndex((p) => p.position === 'police');
const THIEF = POSITIONS.findIndex((p) => p.position === 'thief');

const ICONS = { king: '👑', queen: '👸', thief: '🦹', police: '👮' };

const FINAL_DELETE_DELAY = 60 * 1000;   // grace period before the finished session is wiped


/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

// extra points (or loss) a position gets once the police has guessed
function adjustment(posIndex, correct) {
    if (posIndex === POLICE) return correct ? POSITIONS[POLICE].value : -POSITIONS[POLICE].reduce;
    if (posIndex === THIEF) return correct ? -POSITIONS[THIEF].reduce : POSITIONS[THIEF].value;
    return 0;
}

// whole round for one player: the card value they got when drawing + the guess outcome
const roundDelta = (posIndex, correct) => POSITIONS[posIndex].value + adjustment(posIndex, correct);

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function rankPlayers(players) {
    const ranked = players.map((p) => ({ ...p })).sort((a, b) => b.score - a.score);
    let lastScore = null, lastRank = 0;
    ranked.forEach((p, i) => {
        if (p.score !== lastScore) {
            lastRank = i + 1;
            lastScore = p.score;
        }
        p.rank = lastRank;
    });
    return ranked;
}

function avatarSrc(avatar) {
    try {
        return new URL(`../../other_assets/images/c${avatar}.png`, import.meta.url).href;
    } catch {
        return "";
    }
}



/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const MiniKingdom = () => {

    const navigate = useNavigate();
    const gameId = new URLSearchParams(window.location.search).get(ID);
    const deviceId = readDeviceId(MINI_KINGDOM);

    const [game, setGame] = useState(null);
    const [players, setPlayers] = useState([]);
    const [gameLoaded, setGameLoaded] = useState(false);
    const [playersLoaded, setPlayersLoaded] = useState(false);
    const [gone, setGone] = useState(false);
    const [busy, setBusy] = useState(false);
    const [shaking, setShaking] = useState(false);
    const [accused, setAccused] = useState(null);
    const [copied, setCopied] = useState(false);
    const [finalResult, setFinalResult] = useState(null);

    const resultRef = useRef(null);


    /* ---------- derived ---------- */

    const phase = game?.phase;
    const me = players.find((p) => p.deviceId === deviceId);
    const host = players.find((p) => p.deviceId === game?.hostId);
    const isHost = !!game && game.hostId === deviceId;
    const allJoined = players.length === PLAYER_COUNT;
    const pickedCount = players.filter((p) => p.currentPosition >= 0).length;
    const allPicked = allJoined && pickedCount === PLAYER_COUNT;
    const myPos = me ? me.currentPosition : -1;
    const isPolice = myPos === POLICE;
    const lastRound = !!game && game.currentRound >= game.totalRound;

    // Drawing a card adds its value straight away, which would give the role away on everyone's
    // scoreboard (every value is different). So until the reveal, show the score without it.
    const shownScore = (p) =>
        (phase === 'pick' || phase === 'guess') && p.currentPosition >= 0
            ? p.score - POSITIONS[p.currentPosition].value
            : p.score;

    const roundResult = useMemo(() => {
        if (phase !== 'result') return null;
        const police = players.find((p) => p.currentPosition === POLICE);
        const thief = players.find((p) => p.currentPosition === THIEF);
        if (!police || !thief) return null;
        return {
            police,
            thief,
            accusedPlayer: players.find((p) => p.deviceId === game.guessId),
            correct: game.guessId === thief.deviceId
        };
    }, [phase, players, game]);


    /* ---------- effects ---------- */

    useEffect(() => {

        if (!gameId) return;

        const gameRef = doc(firestore, GAME_COLLECTION, gameId);

        const unsubGame = onSnapshot(gameRef, (snap) => {
            if (snap.exists()) {
                setGame(snap.data());
                setGone(false);
            } else {
                setGame(null);
                setGone(true);
            }
            setGameLoaded(true);
        }, (e) => console.error(e));

        const unsubPlayers = onSnapshot(collection(gameRef, PLAYERS_INFO), (snap) => {
            setPlayers(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
            setPlayersLoaded(true);
        }, (e) => console.error(e));

        return () => {
            unsubGame();
            unsubPlayers();
        };

    }, [gameId]);

    // not joined yet (or no device id) -> go to the join screen while there is still a free seat
    useEffect(() => {
        if (!gameId) return;
        if (!deviceId) {
            navigate(`${PREGAME_ROUTE}?id=${gameId}`);
            return;
        }
        if (!gameLoaded || !playersLoaded || gone || me) return;
        if (players.length < PLAYER_COUNT) navigate(`${PREGAME_ROUTE}?id=${gameId}`);
    }, [gameId, deviceId, gameLoaded, playersLoaded, gone, me, players.length, navigate]);

    useEffect(() => {
        if (phase !== 'guess') setAccused(null);
    }, [phase]);

    // game finished: keep our own copy of the result, because the session is deleted afterwards
    useEffect(() => {
        if (phase === 'finished' && allJoined && !finalResult) {
            setFinalResult(rankPlayers(players));
        }
    }, [phase, allJoined, players, finalResult]);

    // clean-up: whoever is still on the page wipes the session after a grace period
    useEffect(() => {
        if (!finalResult || !gameId) return;
        const t = setTimeout(() => deleteSession(gameId, GAME_COLLECTION), FINAL_DELETE_DELAY);
        return () => clearTimeout(t);
    }, [finalResult, gameId]);


    /* ---------- actions ---------- */

    const gameRef = gameId ? doc(firestore, GAME_COLLECTION, gameId) : null;

    const fail = (e) => {
        console.error(e);
        alert('Something went wrong. Please try again.');
    };

    // host: shake the flask, everybody can then draw
    const shake = async () => {
        if (busy || shaking) return;
        setShaking(true);
        await new Promise((r) => setTimeout(r, 800));
        try {
            await updateDoc(gameRef, { phase: 'pick', deck: POSITIONS.map((_, i) => i) });
        } catch (e) {
            fail(e);
        } finally {
            setShaking(false);
        }
    };

    // everyone: draw a random card from the flask (atomic, so two players can never get the same one)
    const pick = async () => {
        if (busy || !me) return;
        setBusy(true);
        try {
            const myRef = doc(gameRef, PLAYERS_INFO, me.id);
            await runTransaction(firestore, async (tx) => {
                const g = (await tx.get(gameRef)).data();
                const m = (await tx.get(myRef)).data();
                if (!g || !m || g.phase !== 'pick' || m.currentPosition !== -1) return;

                const deck = g.deck || [];
                if (deck.length === 0) return;

                const k = Math.floor(Math.random() * deck.length);
                const card = deck[k];
                const rest = deck.filter((_, i) => i !== k);

                tx.update(myRef, { currentPosition: card, score: increment(POSITIONS[card].value) });
                tx.update(gameRef, rest.length ? { deck: rest } : { deck: rest, phase: 'guess' });   // last card -> police's turn
            });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    // police: accuse somebody
    const accuse = async () => {
        if (!accused || busy || !isPolice) return;
        setBusy(true);
        try {
            const policeP = players.find((p) => p.currentPosition === POLICE);
            const thiefP = players.find((p) => p.currentPosition === THIEF);
            const correct = accused === thiefP.deviceId;

            await runTransaction(firestore, async (tx) => {
                const g = (await tx.get(gameRef)).data();
                if (!g || g.phase !== 'guess') return;

                tx.update(doc(gameRef, PLAYERS_INFO, policeP.id), { score: increment(adjustment(POLICE, correct)) });
                tx.update(doc(gameRef, PLAYERS_INFO, thiefP.id), { score: increment(adjustment(THIEF, correct)) });
                tx.update(gameRef, { phase: 'result', guessId: accused });
            });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    // host: start the next round
    const nextRound = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await runTransaction(firestore, async (tx) => {
                const g = (await tx.get(gameRef)).data();
                if (!g || g.phase !== 'result' || g.currentRound >= g.totalRound) return;

                players.forEach((p) => tx.update(doc(gameRef, PLAYERS_INFO, p.id), { currentPosition: -1 }));
                tx.update(gameRef, { phase: 'shake', currentRound: g.currentRound + 1, deck: [], guessId: null });
            });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    // host: last round is over
    const finishGame = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await updateDoc(gameRef, { phase: 'finished' });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    const copyInvite = () => {
        const link = `${window.location.origin}${PREGAME_ROUTE}?id=${gameId}`;
        navigator.clipboard.writeText(link)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => alert('Failed to copy link'));
    };

    const saveImage = async () => {
        if (!resultRef.current) return;
        try {
            const canvas = await html2canvas(resultRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `mini-kingdom-${Date.now()}.png`;
            a.click();
        } catch (e) {
            console.error("Error saving result image: ", e);
        }
    };

    const closeFinal = async () => {
        if (isHost) await deleteSession(gameId, GAME_COLLECTION);
        navigate('/');
    };


    /* ---------- screens (all hooks are above this line) ---------- */

    if (!gameId) return <div className="mk-card"><p>This game link is missing its id.</p></div>;

    if (finalResult) {

        const winners = finalResult.filter((p) => p.rank === 1);
        const tie = winners.length > 1;
        const iWon = winners.some((w) => w.deviceId === deviceId);

        return (
            <div className="mk-overlay">
                <div className="mk-dialog" ref={resultRef}>
                    <div className="mk-big">{tie ? '🤝' : '🏆'}</div>
                    <h2>{tie ? `It's a tie between ${winners.map((w) => w.name).join(' & ')}!` : `${winners[0].name} wins!`}</h2>
                    <p className="mk-muted">
                        {iWon ? (tie ? 'You shared the crown.' : 'Long live the king! 🎉') : 'Good game — better luck next time.'}
                    </p>

                    <table className="mk-table">
                        <tbody>
                        {finalResult.map((p) => (
                            <tr key={p.deviceId} className={p.rank === 1 ? 'mk-win' : ''}>
                                <td>{p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank}</td>
                                <td><img className="mk-ava" src={avatarSrc(p.avatar)} alt="" /></td>
                                <td className="mk-left">{p.name}{p.deviceId === deviceId ? ' (you)' : ''}</td>
                                <td><strong>{p.score}</strong></td>
                            </tr>
                        ))}
                        </tbody>
                    </table>

                    <div className="mk-actions" data-html2canvas-ignore="true">
                        <button className="mk-btn" onClick={saveImage}>Save image</button>
                        <button className="mk-btn ghost" onClick={closeFinal}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    if (!deviceId || !gameLoaded || !playersLoaded) return null;

    if (gone) {
        return (
            <div className="mk-card">
                <p>This game has ended or doesn't exist.</p>
                <button className="mk-btn" onClick={() => navigate('/')}>Home</button>
            </div>
        );
    }

    if (!me) {
        return players.length >= PLAYER_COUNT
            ? <div className="mk-card"><p>This game is already full.</p></div>
            : null;     // redirecting to the join screen
    }

    // lobby
    if (!allJoined) {
        return (
            <div className="mk-card">
                <h2>Waiting for players ({players.length}/{PLAYER_COUNT})</h2>
                <div className="mk-list">
                    {players.map((p) => (
                        <div key={p.deviceId} className="mk-row">
                            <img className="mk-ava" src={avatarSrc(p.avatar)} alt="" />
                            <span>{p.name}{p.deviceId === deviceId ? ' (you)' : ''}</span>
                        </div>
                    ))}
                </div>
                <button className="mk-btn" onClick={copyInvite}>{copied ? 'Copied!' : 'Copy invite link'}</button>
            </div>
        );
    }

    const myCard = myPos >= 0 ? (
        <div className="mk-role">
            <div className="mk-big">{ICONS[POSITIONS[myPos].position]}</div>
            <h3>You are the {POSITIONS[myPos].position}</h3>
            <p className="mk-muted">Keep it secret!</p>
        </div>
    ) : null;

    return (
        <div className="mk-card">

            <div className="mk-top">Round {game.currentRound} / {game.totalRound}</div>

            <div className="mk-scoreboard">
                {players.map((p) => (
                    <div key={p.deviceId} className={`mk-score ${p.deviceId === deviceId ? 'me' : ''}`}>
                        <img className="mk-ava" src={avatarSrc(p.avatar)} alt="" />
                        <span>{p.name}</span>
                        <strong>{shownScore(p)}</strong>
                    </div>
                ))}
            </div>

            {phase === 'shake' && (isHost ? (
                <>
                    <button className={`mk-flask ${shaking ? 'mk-shaking' : ''}`} onClick={shake} disabled={shaking}>🧪</button>
                    <p>Tap the flask to shake it</p>
                </>
            ) : (
                <p className="mk-muted">Waiting for {host?.name ?? 'the host'} to shake the flask…</p>
            ))}

            {phase === 'pick' && (myPos === -1 ? (
                <>
                    <button className="mk-flask" onClick={pick} disabled={busy}>🧪</button>
                    <p>Tap the flask to pick your card</p>
                </>
            ) : (
                <>
                    {myCard}
                    <p className="mk-muted">Waiting for the others ({pickedCount}/{PLAYER_COUNT})…</p>
                </>
            ))}

            {phase === 'guess' && (
                <>
                    {myCard}
                    <p className="mk-muted">
                        {isPolice ? 'Find the thief!' : 'The police is searching for the thief…'}
                    </p>
                </>
            )}

            {phase === 'guess' && allPicked && isPolice && (
                <div className="mk-overlay">
                    <div className="mk-dialog">
                        <h2>👮 Who is the thief?</h2>
                        <div className="mk-options">
                            {players.filter((p) => p.deviceId !== deviceId).map((p) => (
                                <button key={p.deviceId}
                                        className={`mk-option ${accused === p.deviceId ? 'selected' : ''}`}
                                        onClick={() => setAccused(p.deviceId)}>
                                    <img className="mk-ava" src={avatarSrc(p.avatar)} alt="" />
                                    <span>{p.name}</span>
                                </button>
                            ))}
                        </div>
                        <button className="mk-btn" disabled={!accused || busy} onClick={accuse}>Accuse</button>
                    </div>
                </div>
            )}

            {phase === 'result' && (roundResult ? (
                <>
                    <h3>
                        {roundResult.correct
                            ? `${roundResult.police.name} caught the thief, ${roundResult.thief.name}!`
                            : `${roundResult.police.name} accused ${roundResult.accusedPlayer?.name ?? 'someone'} — wrong! The thief was ${roundResult.thief.name}.`}
                    </h3>

                    <table className="mk-table">
                        <tbody>
                        {[...players].sort((a, b) => a.currentPosition - b.currentPosition).map((p) => (
                            <tr key={p.deviceId}>
                                <td><img className="mk-ava" src={avatarSrc(p.avatar)} alt="" /></td>
                                <td className="mk-left">{p.name}</td>
                                <td>{ICONS[POSITIONS[p.currentPosition].position]} {POSITIONS[p.currentPosition].position}</td>
                                <td>{signed(roundDelta(p.currentPosition, roundResult.correct))}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>

                    {isHost ? (
                        <button className="mk-btn" onClick={lastRound ? finishGame : nextRound} disabled={busy}>
                            {lastRound ? 'Finish game' : 'Next round'}
                        </button>
                    ) : (
                        <p className="mk-muted">Waiting for {host?.name ?? 'the host'} to continue…</p>
                    )}
                </>
            ) : (
                <p className="mk-muted">Calculating…</p>
            ))}

        </div>
    );
};
