import  { useEffect, useMemo, useState } from "react";
import './pre_game_definition.css';
import { useNavigate } from "react-router-dom";
import { firestore } from "../../firebase";
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import {randomId, readDeviceId} from "../../other_assets/helpers/methods.jsx";
import {HOUSE_BLOCK, PLAYERS_INFO} from "../../other_assets/helpers/constants.jsx";

// Every player needs a unique avatar, so this list is also the player limit.
// Add more images (and ids here) and the limit grows automatically.
const AVATARS = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const MIN_DOTS = 3;
const MIN_PLAYERS = 2;



export const PreGameDefinitionHouseBlock = () => {

    const navigate = useNavigate();
    const gameId = new URLSearchParams(window.location.search).get('id');
    const isJoining = !!gameId;

    // reuse this browser's device id if present, so a refresh keeps your seat
    const [deviceId] = useState(() => readDeviceId(HOUSE_BLOCK) || randomId());

    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState(AVATARS[0]);
    const [rowNo, setRowNo] = useState(5);
    const [playerNo, setPlayerNo] = useState(2);
    const [busy, setBusy] = useState(false);
    const [players, setPlayers] = useState([]);
    const [error, setError] = useState('');

    // when joining, watch who is already in the game (live)
    useEffect(() => {
        if (!isJoining) return;
        return onSnapshot(
            collection(firestore, HOUSE_BLOCK, gameId, PLAYERS_INFO),
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

        const rows = Number(rowNo);
        const maxPlayers = Number(playerNo);

        if (!isJoining) {
            if (!Number.isInteger(rows) || rows < MIN_DOTS) {
                setError(`Dots per row must be a whole number, ${MIN_DOTS} or more`);
                return;
            }
            if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS) {
                setError(`Number of players must be a whole number, ${MIN_PLAYERS} or more`);
                return;
            }
            if (maxPlayers > AVATARS.length) {
                setError(`Every player needs their own avatar and there are ${AVATARS.length}, so ${AVATARS.length} players is the most this game can hold.`);
                return;
            }
        }

        setBusy(true);

        try {

            let id = gameId;

            if (!isJoining) {
                id = randomId();
                await setDoc(doc(firestore, "houseBlock", id), {
                    rowNo: rows,
                    playerNo: maxPlayers,
                    currentChance: deviceId,
                    dotsConnected: ""
                });
            }

            const playerRef = doc(firestore, HOUSE_BLOCK, id, PLAYERS_INFO, deviceId);
            let alreadyIn = false;

            if (isJoining) {

                const snap = await getDoc(doc(firestore, HOUSE_BLOCK, id));
                if (!snap.exists()) {
                    setError('Game not found');
                    setBusy(false);
                    return;
                }

                // re-check against the server right before writing (the live list can be a moment behind)
                const current = await getDocs(collection(firestore, HOUSE_BLOCK, id, PLAYERS_INFO));
                const others = current.docs.filter((d) => d.id !== deviceId).map((d) => d.data());
                alreadyIn = current.docs.some((d) => d.id === deviceId);

                if (!alreadyIn && others.length >= Number(snap.data().playerNo)) {
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
                // coming back to your seat: change name/avatar only, keep the houses you already own
                await updateDoc(playerRef, { name: name.trim(), avatar: avatar });
            }
            else {
                await setDoc(playerRef, {
                    deviceId: deviceId,
                    name: name.trim(),
                    avatar: avatar,
                    occupied: []
                });
            }

            localStorage.setItem('houseBlock', JSON.stringify({ deviceId: deviceId }));
            navigate(`/houseblock?id=${id}`);

        }
        catch (e) {
            console.error(e);
            setError('Something went wrong. Please try again.');
            setBusy(false);
        }

    }

    const rowsNum = Number(rowNo);
    const housesHint = Number.isInteger(rowsNum) && rowsNum >= MIN_DOTS ? `${(rowsNum - 1) ** 2} houses to win` : `Minimum ${MIN_DOTS}`;

    return (
        <div className="pregame_page">
            <form className="pregame_container" noValidate
                  onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>

                <div className="pg_head">
                    <h2>{isJoining ? 'Join the game' : 'Start a new game'}</h2>
                    <p>{isJoining
                        ? 'Pick a name and an avatar to take your seat.'
                        : 'Connect the dots, close boxes, claim houses. Most houses wins.'}</p>
                </div>

                <label className="pg_field">
                    <span>Your name</span>
                    <input type="text" placeholder="e.g. Alex" maxLength={20}
                           value={name} onChange={e => setName(e.target.value)} />
                </label>

                {!isJoining && (
                    <div className="pg_row">
                        <label className="pg_field">
                            <span>Dots per row</span>
                            <input type="number" min={MIN_DOTS} step="1" inputMode="numeric"
                                   value={rowNo} onChange={e => setRowNo(e.target.value)} />
                            <small>{housesHint}</small>
                        </label>
                        <label className="pg_field">
                            <span>Players</span>
                            <input type="number" min={MIN_PLAYERS} max={AVATARS.length} step="1" inputMode="numeric"
                                   value={playerNo} onChange={e => setPlayerNo(e.target.value)} />
                            <small>{MIN_PLAYERS} to {AVATARS.length}</small>
                        </label>
                    </div>
                )}

                <div className="pg_field">
                    <span>Pick your avatar{takenAvatars.size > 0 ? ` (${takenAvatars.size} taken)` : ''}</span>
                    <div className="imageCont" role="radiogroup" aria-label="Avatar">
                        {AVATARS.map(a => {
                            const taken = takenAvatars.has(String(a));
                            const chosen = avatar === a;
                            return (
                                <button type="button" key={a}
                                        className={`avatar_btn${chosen ? ' is_selected' : ''}`}
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

                {error && <div className="pg_error" role="alert">{error}</div>}

                <button type="submit" className="submit" disabled={busy}>
                    {busy ? 'Please wait…' : isJoining ? 'Join game' : 'Create game'}
                </button>

            </form>
        </div>
    );
}
