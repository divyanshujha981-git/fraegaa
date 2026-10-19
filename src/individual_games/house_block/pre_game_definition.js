import React, { useEffect, useMemo, useState } from "react";
import './pre_game_definition.css';
import { useNavigate } from "react-router-dom";
import { firestore } from "../../firebase";
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";

// Every player needs a unique avatar, so this list is also the player limit.
// Add more images (and ids here) and the limit grows automatically.
const AVATARS = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const MIN_DOTS = 3;
const MIN_PLAYERS = 2;

function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function readDeviceId() {
    try {
        return JSON.parse(localStorage.getItem('houseBlock')).deviceId || null;
    } catch {
        return null;
    }
}

export const PreGameDefinition = () => {

    const navigate = useNavigate();
    const gameId = new URLSearchParams(window.location.search).get('id');
    const isJoining = !!gameId;

    // reuse this browser's device id if present, so a refresh keeps your seat
    const [deviceId] = useState(() => readDeviceId() || randomId());

    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState(AVATARS[0]);
    const [rowNo, setRowNo] = useState(5);
    const [playerNo, setPlayerNo] = useState(2);
    const [busy, setBusy] = useState(false);
    const [players, setPlayers] = useState([]);

    // when joining, watch who is already in the game (live)
    useEffect(() => {
        if (!isJoining) return;
        return onSnapshot(
            collection(firestore, "houseBlock", gameId, "playersInfo"),
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

        if (!name.trim()) {
            alert('Please enter your name');
            return;
        }

        const rows = Number(rowNo);
        const maxPlayers = Number(playerNo);

        if (!isJoining) {
            if (!Number.isInteger(rows) || rows < MIN_DOTS) {
                alert(`Dots per row must be a whole number, ${MIN_DOTS} or more`);
                return;
            }
            if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS) {
                alert(`Number of players must be a whole number, ${MIN_PLAYERS} or more`);
                return;
            }
            if (maxPlayers > AVATARS.length) {
                alert(`Every player needs their own avatar and there are ${AVATARS.length}, so ${AVATARS.length} players is the most this game can hold.`);
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

            const playerRef = doc(firestore, "houseBlock", id, "playersInfo", deviceId);
            let alreadyIn = false;

            if (isJoining) {

                const snap = await getDoc(doc(firestore, "houseBlock", id));
                if (!snap.exists()) {
                    alert('Game not found');
                    setBusy(false);
                    return;
                }

                // re-check against the server right before writing (the live list can be a moment behind)
                const current = await getDocs(collection(firestore, "houseBlock", id, "playersInfo"));
                const others = current.docs.filter((d) => d.id !== deviceId).map((d) => d.data());
                alreadyIn = current.docs.some((d) => d.id === deviceId);

                if (!alreadyIn && others.length >= Number(snap.data().playerNo)) {
                    alert('This game is already full.');
                    setBusy(false);
                    return;
                }

                if (others.some((p) => String(p.avatar) === String(avatar))) {
                    alert('Someone just picked that avatar. Please choose another one.');
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
            alert('Something went wrong. Please try again.');
            setBusy(false);
        }

    }

    return (
        <div className="pregame_container" style={{ width: 'min(90vw, 380px)', padding: '20px' }}>

            <h2 style={{ width: '100%', textAlign: 'center', margin: 0 }}>{isJoining ? 'Join game' : 'New game'}</h2>

            <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />

            {!isJoining && (
                <>
                    <input type="number" min={MIN_DOTS} step="1" placeholder={`Dots per row (min ${MIN_DOTS})`}
                           value={rowNo} onChange={e => setRowNo(e.target.value)} />
                    <input type="number" min={MIN_PLAYERS} max={AVATARS.length} step="1" placeholder={`Number of players (min ${MIN_PLAYERS})`}
                           value={playerNo} onChange={e => setPlayerNo(e.target.value)} />
                </>
            )}

            <div className="imageCont">
                {AVATARS.map(a => {
                    const taken = takenAvatars.has(String(a));
                    return (
                        <img
                            key={a}
                            src={require(`./images/c${a}.png`)}
                            alt=""
                            height="60"
                            title={taken ? 'Already taken' : ''}
                            aria-disabled={taken}
                            onClick={() => { if (!taken) setAvatar(a); }}
                            style={{
                                cursor: taken ? 'not-allowed' : 'pointer',
                                borderRadius: '50%',
                                outline: avatar === a ? '3px solid #0d6efd' : 'none',
                                opacity: taken ? 0.25 : 1,
                                filter: taken ? 'grayscale(1)' : 'none'
                            }}
                        />
                    );
                })}
            </div>

            <button className="submit" onClick={submit} disabled={busy}>
                {isJoining ? 'Join' : 'Create game'}
            </button>

        </div>
    );
}
