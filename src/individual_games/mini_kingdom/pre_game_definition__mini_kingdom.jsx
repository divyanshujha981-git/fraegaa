import  { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { firestore } from "../../firebase";
import { randomId, readDeviceId } from "../../other_assets/helpers/methods.jsx";
import {MINI_KINGDOM, PLAYERS_INFO} from "../../other_assets/helpers/constants.jsx";
import { GAME_COLLECTION, GAME_ROUTE, PLAYER_COUNT } from "./mini_kingdom.jsx";
import './mini_kingdom.css';


// one unique avatar per player, so there must be at least PLAYER_COUNT of these
const AVATARS = [0, 1, 3, 4];


/*
    host    -> name, rounds, avatar   (creates the game)
    joining -> name, avatar           (?id=<gameId> in the url)

    miniKingdom/{gameId}                       totalRound, currentRound, hostId, phase, deck, guessId
        playersInfo/{deviceId}                 name, avatar, deviceId, score, currentPosition (-1 = none)
*/


export const PreGameDefinitionMiniKingdom = () => {

    const navigate = useNavigate();
    const gameId = new URLSearchParams(window.location.search).get('id');
    const isJoining = !!gameId;

    const [name, setName] = useState('');
    const [round, setRound] = useState('1');
    const [busy, setBusy] = useState(false);
    const [avatar, setAvatar] = useState(AVATARS[0]);
    const [deviceId] = useState(() => readDeviceId(MINI_KINGDOM) || randomId());
    const [players, setPlayers] = useState([]);
    const [error, setError] = useState('');

    const rounds = Number(round);
    const roundsValid = Number.isInteger(rounds) && rounds >= 1;

    // when joining, watch who is already in (live)
    useEffect(() => {
        if (!isJoining) return;
        return onSnapshot(
            collection(firestore, GAME_COLLECTION, gameId, PLAYERS_INFO),
            (snap) => setPlayers(snap.docs.map((d) => d.data())),
            (err) => console.error(err)
        );
    }, [isJoining, gameId]);

    // avatars used by *other* players (your own seat's avatar stays selectable)
    const takenAvatars = useMemo(
        () => new Set(players.filter((p) => p.deviceId !== deviceId).map((p) => String(p.avatar))),
        [players, deviceId]
    );

    // if the selected avatar gets taken, move to the first free one
    useEffect(() => {
        if (takenAvatars.has(String(avatar))) {
            const free = AVATARS.find((a) => !takenAvatars.has(String(a)));
            if (free !== undefined) setAvatar(free);
        }
    }, [takenAvatars, avatar]);

    async function submit() {

        setError('');

        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }

        if (!isJoining && !roundsValid) {
            setError('Please enter a whole number of rounds, 1 or more.');
            return;
        }

        setBusy(true);

        try {

            let id = gameId;

            if (!isJoining) {
                id = randomId();
                await setDoc(doc(firestore, GAME_COLLECTION, id), {
                    totalRound: rounds,
                    currentRound: 1,
                    hostId: deviceId,
                    phase: 'shake',
                    deck: [],
                    guessId: null
                });
            }

            const playerRef = doc(firestore, GAME_COLLECTION, id, PLAYERS_INFO, deviceId);
            let alreadyIn = false;

            if (isJoining) {

                const snap = await getDoc(doc(firestore, GAME_COLLECTION, id));
                if (!snap.exists()) {
                    setError('Game not found');
                    setBusy(false);
                    return;
                }

                // re-check against the server right before writing
                const current = await getDocs(collection(firestore, GAME_COLLECTION, id, PLAYERS_INFO));
                const others = current.docs.filter((d) => d.id !== deviceId).map((d) => d.data());
                alreadyIn = current.docs.some((d) => d.id === deviceId);

                if (!alreadyIn && others.length >= PLAYER_COUNT) {
                    setError('This game is already full.');
                    setBusy(false);
                    return;
                }

                if (others.some((p) => String(p.avatar) === String(avatar))) {
                    setError('Someone just picked that avatar. Please choose another one.');
                    setBusy(false);
                    return;
                }

            }

            if (alreadyIn) {
                // coming back to your seat: change name/avatar only, keep your score
                await updateDoc(playerRef, { name: name.trim(), avatar: avatar });
            }
            else {
                await setDoc(playerRef, {
                    name: name.trim(),
                    avatar: avatar,
                    deviceId: deviceId,
                    score: 0,
                    currentPosition: -1
                });
            }

            localStorage.setItem(MINI_KINGDOM, JSON.stringify({ deviceId: deviceId }));
            navigate(`${GAME_ROUTE}?id=${id}`);

        }
        catch (e) {
            console.error(e);
            setError('Something went wrong. Please try again.');
            setBusy(false);
        }

    }


    return (
        <form className="mk-card" noValidate
              onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>

            <div className="mk-big">👑</div>

            <div className="mk-head">
                <h2>{isJoining ? 'Join the kingdom' : 'Found a new kingdom'}</h2>
                <p className="mk-muted">
                    {isJoining
                        ? `${players.length} of ${PLAYER_COUNT} seats taken. Pick a name and an avatar.`
                        : 'Four players: king, queen, thief and police. Highest score wins.'}
                </p>
            </div>

            <label className="mk-field">
                <span>Your name</span>
                <input type="text" placeholder="e.g. Alex" maxLength={20}
                       value={name} onChange={e => setName(e.target.value)} />
            </label>

            <div className="mk-field">
                <span>Pick your avatar</span>
                <div className="mk-avatars" role="radiogroup" aria-label="Avatar">
                    {AVATARS.map(a => {
                        const taken = takenAvatars.has(String(a));
                        const chosen = avatar === a;
                        return (
                            <button type="button" key={a}
                                    className={`mk-pick ${chosen ? 'selected' : ''} ${taken ? 'taken' : ''}`}
                                    role="radio" aria-checked={chosen}
                                    disabled={taken}
                                    title={taken ? 'Already taken' : ''}
                                    onClick={() => setAvatar(a)}>
                                <img src={new URL(`../../other_assets/images/c${a}.png`, import.meta.url).href} alt="" />
                            </button>
                        );
                    })}
                </div>
            </div>

            {!isJoining && (
                <label className="mk-field">
                    <span>Number of rounds</span>
                    <input type="number" min="1" step="1" inputMode="numeric"
                           value={round} onChange={e => setRound(e.target.value)} />
                    <small className="mk-muted">
                        {roundsValid ? `${rounds} round${rounds === 1 ? '' : 's'} of shaking, picking and guessing` : 'Enter a whole number, 1 or more'}
                    </small>
                </label>
            )}

            {error && <div className="mk-error" role="alert">{error}</div>}

            <button type="submit" className="mk-btn mk-block" disabled={busy || (!isJoining && !roundsValid)}>
                {busy ? 'Please wait…' : isJoining ? 'Join game' : 'Create game'}
            </button>

        </form>
    );
};
