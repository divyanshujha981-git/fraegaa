import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import './house_block.css';
import { useNavigate } from "react-router-dom";
import { firestore } from "../../firebase";
import { arrayUnion, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import html2canvas from "html2canvas";


/* ------------------------------------------------------------------ */
/*  Module state + small helpers                                       */
/* ------------------------------------------------------------------ */

const mapNode = new Map();      // dot -> Set of connected dots

let deviceId;
let id;

const OWNER_COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599'];

// first few are hand-picked; beyond that, spread hues around the colour wheel so any player count stays distinct
const ownerColor = (i) => (i < OWNER_COLORS.length ? OWNER_COLORS[i] : `hsl(${Math.round((i * 137.5) % 360)}, 65%, 45%)`);

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

const areAdjacent = (a, b, n) =>
    Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n)) === 1;

function avatarSrc(avatar) {
    try {
        return require(`./images/c${avatar}.png`);
    } catch {
        return "";
    }
}

function vhToPixels(vh) {
    return (vh / 100) * window.innerHeight;
}


/* ------------------------------------------------------------------ */
/*  Edge (line) bookkeeping                                            */
/* ------------------------------------------------------------------ */

function hasEdge(a, b) {
    return !!mapNode.get(a)?.has(b);
}

function addEdge(a, b) {
    if (!mapNode.has(a)) mapNode.set(a, new Set());
    if (!mapNode.has(b)) mapNode.set(b, new Set());
    mapNode.get(a).add(b);
    mapNode.get(b).add(a);
}

function removeEdge(a, b) {
    mapNode.get(a)?.delete(b);
    mapNode.get(b)?.delete(a);
}

function getEdges() {
    const out = [];
    mapNode.forEach((set, a) => set.forEach((b) => {
        if (a < b) out.push([a, b]);
    }));
    return out;
}

// keyed per game so an old game's lines never leak into a new one
const storageKey = () => `mapData_${id}`;

function saveMap() {
    try {
        const data = JSON.stringify([...mapNode].map(([key, value]) => [key, [...value]]));
        localStorage.setItem(storageKey(), data);
    } catch (e) {
        console.error("Error saving map data", e);
    }
}

function loadMap() {
    try {
        const data = JSON.parse(localStorage.getItem(storageKey()));
        if (!Array.isArray(data)) return;
        data.forEach(([key, value]) => mapNode.set(key, new Set(value)));
    } catch {
        console.error("Error parsing local storage data");
    }
}


/* ------------------------------------------------------------------ */
/*  House (box) detection                                              */
/* ------------------------------------------------------------------ */

// corners in drawing order: [top-left, top-right, bottom-right, bottom-left]
function makeBox(...ids) {
    if (ids.some((n) => n < 0)) return null;
    const [a, b, c, d] = [...ids].sort((x, y) => x - y);
    return [a, b, d, c];
}

const boxIsComplete = (box) => box.every((corner, i) => hasEdge(corner, box[(i + 3) % 4]));

// Which boxes did the edge prevId--id just complete?
function checkHouse(prevId, id, rowNo) {

    const candidates = [];

    if (Math.abs(id - prevId) === 1) {
        // horizontal edge -> boxes above and below it
        candidates.push(makeBox(id - rowNo, id, prevId - rowNo, prevId));
        candidates.push(makeBox(id + rowNo, id, prevId + rowNo, prevId));
    }
    else {
        // vertical edge -> boxes left and right of it
        candidates.push(makeBox(id - 1, id, prevId, prevId - 1));
        candidates.push(makeBox(id + 1, id, prevId, prevId + 1));
    }

    return candidates.filter(Boolean).filter(boxIsComplete);

}


/* ------------------------------------------------------------------ */
/*  Firestore                                                          */
/* ------------------------------------------------------------------ */

async function changeChance(playersData) {

    const current = playersData.findIndex((p) => sameId(p.deviceId, deviceId));
    if (current === -1) return;

    const nextDeviceId = playersData[(current + 1) % playersData.length].deviceId;

    try {
        await updateDoc(doc(firestore, "houseBlock", id + ""), { currentChance: nextDeviceId });
    } catch (error) {
        console.error("Error updating document: ", error);
    }

}

async function dotsConnectedFirebase(p1, p2) {
    try {
        await updateDoc(doc(firestore, "houseBlock", id + ""), { dotsConnected: p1 + "_" + p2 });
        return true;
    } catch (error) {
        console.error("Error updating document: ", error);
        return false;
    }
}

async function addOccupiedToFirebase(houseString) {
    try {
        await updateDoc(doc(firestore, "houseBlock", id + "", "playersInfo", deviceId + ""), {
            occupied: arrayUnion(houseString)
        });
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

function subscribeToGame(gameId, onGame, onPlayers) {

    const parentDocRef = doc(firestore, "houseBlock", gameId + "");

    const unsubGame = onSnapshot(parentDocRef, (snap) => {
        if (snap.exists()) onGame(snap.data());
    });

    const unsubPlayers = onSnapshot(collection(parentDocRef, "playersInfo"), (snap) => {
        onPlayers(snap.docs.map((d) => d.data()));
    });

    return () => {
        unsubGame();
        unsubPlayers();
    };

}


/* ------------------------------------------------------------------ */
/*  Misc                                                               */
/* ------------------------------------------------------------------ */

function copyLink() {
    let link = document.getElementById('linkText');
    link.select();
    link.setSelectionRange(0, window.location.href.length);

    window.navigator.clipboard.writeText(link.value)
        .then(() => alert('Link copied successfully'))
        .catch(() => alert('Failed to copy link'));
}

function sameLayout(a, b) {
    if (Math.abs(a.origin.x - b.origin.x) > 0.5 || Math.abs(a.origin.y - b.origin.y) > 0.5) return false;
    if (a.dots.length !== b.dots.length) return false;
    return a.dots.every((d, i) => {
        const e = b.dots[i];
        if (!d || !e) return d === e;
        return Math.abs(d.x - e.x) <= 0.5 && Math.abs(d.y - e.y) <= 0.5;
    });
}

const S = {
    backdrop: {
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15, 15, 30, 0.65)', padding: 16
    },
    card: {
        background: '#ffffff', color: '#1e1e2f', borderRadius: 16, padding: '24px 28px',
        maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        maxHeight: '90vh', overflowY: 'auto'
    },
    table: { width: '100%', borderCollapse: 'collapse', margin: '16px 0' },
    td: { padding: '6px 8px', textAlign: 'left', verticalAlign: 'middle' },
    actions: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
    btn: {
        padding: '8px 16px', borderRadius: 8, border: '1px solid #1e1e2f',
        background: '#1e1e2f', color: '#fff', cursor: 'pointer', fontWeight: 600
    },
    btnGhost: {
        padding: '8px 16px', borderRadius: 8, border: '1px solid #1e1e2f',
        background: '#fff', color: '#1e1e2f', cursor: 'pointer', fontWeight: 600
    },
    selectBtn: {
        position: 'absolute', pointerEvents: 'auto', cursor: 'pointer', fontWeight: 700,
        border: '2px solid #e8590c', borderRadius: 8, background: 'rgba(255, 255, 255, 0.92)'
    }
};


/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const HouseBlock = () => {

    const navigate = useNavigate();

    id = new URLSearchParams(window.location.search).get('id');

    try {
        deviceId = JSON.parse(localStorage.getItem('houseBlock')).deviceId || null;
    } catch {
        deviceId = null;
    }

    const [firebaseData, setFirebaseData] = useState(null);
    const [playersData, setPlayersData] = useState([]);
    const [playersLoaded, setPlayersLoaded] = useState(false);
    const [selected, setSelected] = useState(null);        // first dot of the line being drawn
    const [edges, setEdges] = useState([]);
    const [pending, setPending] = useState([]);            // finished houses waiting to be claimed
    const [busy, setBusy] = useState(false);
    const [showResult, setShowResult] = useState(true);
    const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const [layout, setLayout] = useState({ origin: { x: 0, y: 0 }, dots: [] });

    const svgRef = useRef(null);
    const resultRef = useRef(null);


    /* ---------- derived data ---------- */

    const no = firebaseData ? parseInt(firebaseData.rowNo, 10) || 0 : 0;
    const totalHouses = no > 1 ? (no - 1) ** 2 : 0;

    const allJoined = !!firebaseData && playersData.length === Number(firebaseData.playerNo);
    const myData = playersData.find((p) => sameId(p.deviceId, deviceId));
    const isMyTurn = !!firebaseData && sameId(firebaseData.currentChance, deviceId);

    const { houses, taken, scores, ranked } = useMemo(() => {

        const houses = [];
        const taken = new Set();

        const scores = playersData.map((p, index) => {

            const color = ownerColor(index);
            const occ = Array.isArray(p.occupied) ? p.occupied : [];
            let points = 0;

            occ.forEach((entry) => {
                let corners;
                try {
                    corners = typeof entry === 'string' ? JSON.parse(entry) : entry;
                } catch {
                    return;
                }
                if (!Array.isArray(corners) || corners.length !== 4) return;

                const key = corners.join(',');
                if (taken.has(key)) return;

                taken.add(key);
                houses.push({ key, corners, name: p.name, avatar: p.avatar, color });
                points++;
            });

            return { deviceId: p.deviceId, name: p.name, avatar: p.avatar, color, points };

        });

        // sort by points; players with equal points share a rank (1, 1, 3 ...)
        const ranked = [...scores].sort((a, b) => b.points - a.points);
        let lastPoints = null, lastRank = 0;
        ranked.forEach((s, i) => {
            if (s.points !== lastPoints) {
                lastRank = i + 1;
                lastPoints = s.points;
            }
            s.rank = lastRank;
        });

        return { houses, taken, scores, ranked };

    }, [playersData]);

    const edgeSet = useMemo(() => new Set(edges.map(([a, b]) => edgeKey(a, b))), [edges]);

    const claimed = houses.length;
    const gameOver = totalHouses > 0 && claimed >= totalHouses;
    const winners = gameOver ? ranked.filter((s) => s.rank === 1) : [];
    const isTie = winners.length > 1;
    const iWon = winners.some((w) => sameId(w.deviceId, deviceId));

    const currentPlayer = firebaseData ? playersData.find((p) => sameId(p.deviceId, firebaseData.currentChance)) : null;
    const visiblePending = pending.filter((h) => !taken.has(h.join(',')));

    let lastKey = null;
    try {
        const [a, b] = firebaseData.dotsConnected.split('_').map((n) => parseInt(n, 10));
        if (!Number.isNaN(a) && !Number.isNaN(b)) lastKey = edgeKey(a, b);
    } catch { /* no move yet */ }


    /* ---------- measuring: dot centres, relative to the svg ---------- */

    const measure = useCallback(() => {

        const svg = svgRef.current;
        if (!svg || !no) return;

        const o = svg.getBoundingClientRect();
        const dots = [];

        for (let k = 0; k < no * no; k++) {
            const el = document.getElementById(String(k));
            if (!el) {
                dots.push(null);
                continue;
            }
            const r = el.getBoundingClientRect();
            dots.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }

        const next = { origin: { x: o.left, y: o.top }, dots };
        setLayout((prev) => (sameLayout(prev, next) ? prev : next));

    }, [no]);

    // re-measure after every commit; sameLayout() stops it from looping
    useLayoutEffect(() => {
        measure();
    });


    /* ---------- effects ---------- */

    useEffect(() => {
        if (!deviceId) navigate(`/houseblock/pregame_definition?id=${id}`);
        // eslint-disable-next-line
    }, []);

    useEffect(() => {
        mapNode.clear();
        loadMap();
        setEdges(getEdges());

        return subscribeToGame(
            id,
            setFirebaseData,
            (arr) => {
                setPlayersData(arr);
                setPlayersLoaded(true);
            }
        );
        // eslint-disable-next-line
    }, []);

    // someone else's move arrives
    useEffect(() => {

        const last = firebaseData?.dotsConnected;
        if (typeof last !== 'string') return;

        const [a, b] = last.split('_').map((n) => parseInt(n, 10));
        if (Number.isNaN(a) || Number.isNaN(b) || a === b) return;

        if (!hasEdge(a, b)) {
            addEdge(a, b);
            saveMap();
            setEdges(getEdges());
        }

    }, [firebaseData]);

    useEffect(() => {
        const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // the "Select" buttons are position: fixed, so keep them glued to the board while scrolling
    useEffect(() => {

        if (visiblePending.length === 0) return;

        let raf = 0;
        const onScroll = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(measure);
        };

        window.addEventListener('scroll', onScroll, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('scroll', onScroll, true);
        };

    }, [visiblePending.length, measure]);

    useEffect(() => {
        if (!isMyTurn) {
            setPending([]);
            setSelected(null);
        }
    }, [isMyTurn]);

    // not a member of this game and it isn't full -> go join
    useEffect(() => {
        if (!firebaseData || !playersLoaded || myData || !deviceId) return;
        if (playersData.length !== Number(firebaseData.playerNo)) {
            navigate(`/houseblock/pregame_definition?id=${id}`);
        }
    }, [firebaseData, playersLoaded, myData, playersData.length, navigate]);


    /* ---------- early outs (all hooks are above this line) ---------- */

    if (!deviceId || !firebaseData || !playersLoaded) return null;

    if (!myData) {
        return <h3 id="h3">This game is already full.</h3>;
    }


    /* ---------- actions ---------- */

    const dotDisabled = (i) => {
        if (!allJoined || !isMyTurn || busy || gameOver || visiblePending.length > 0) return true;
        if (selected === null || i === selected) return false;
        return !areAdjacent(selected, i, no) || edgeSet.has(edgeKey(selected, i));
    };

    const handleDotClick = async (dotId) => {

        if (busy) return;

        if (selected === null) {
            setSelected(dotId);
            return;
        }

        if (dotId === selected) {         // click the same dot again = cancel
            setSelected(null);
            return;
        }

        const from = selected;
        setSelected(null);
        setBusy(true);

        try {

            addEdge(from, dotId);
            saveMap();
            setEdges(getEdges());

            const ok = await dotsConnectedFirebase(from, dotId);

            if (!ok) {                    // keep local state in sync with the server
                removeEdge(from, dotId);
                saveMap();
                setEdges(getEdges());
                return;
            }

            const completed = checkHouse(from, dotId, no).filter((h) => !taken.has(h.join(',')));

            if (completed.length > 0) {
                setPending(completed);    // completed a house: claim it, then go again
            }
            else {
                await changeChance(playersData);
            }

        } finally {
            setBusy(false);
        }

    };

    const claimHouse = async (box) => {

        if (busy) return;
        setBusy(true);

        try {
            const ok = await addOccupiedToFirebase(JSON.stringify(box));
            if (ok) setPending((prev) => prev.filter((h) => h.join(',') !== box.join(',')));
        } finally {
            setBusy(false);
        }

    };

    const saveResult = async () => {

        if (!resultRef.current) return;

        try {
            const canvas = await html2canvas(resultRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `winner-${Date.now()}.png`;
            a.click();
        } catch (e) {
            console.error("Error saving result image: ", e);
        }

    };


    /* ---------- rendering helpers ---------- */

    const o = layout.origin;

    const boxGeometry = (corners) => {
        const tl = layout.dots[corners[0]];
        const br = layout.dots[corners[2]];
        if (!tl || !br) return null;
        const w = br.x - tl.x, h = br.y - tl.y;
        if (w <= 0 || h <= 0) return null;
        return { tl, br, w, h, pad: Math.min(w, h) * 0.14 };
    };

    let statusText = '';
    if (allJoined) {
        if (gameOver) statusText = 'Game over!';
        else if (visiblePending.length > 0) statusText = 'You closed a house! Select it to claim it.';
        else if (isMyTurn) statusText = 'Your turn';
        else statusText = `${currentPlayer?.name ?? 'Another player'}'s turn`;
    }

    let headline = '', subline = '';
    if (gameOver) {
        headline = isTie ? `It's a tie between ${winners.map((w) => w.name).join(' & ')}!` : `${winners[0].name} wins!`;
        if (iWon) subline = isTie ? 'You shared the top spot.' : "Congratulations, you're the boss! 🎉";
        else subline = 'Good game — better luck next time.';
    }


    return (
        <>
            <div className="houseBlockContainer">

                <h3 id="h3">Welcome {myData.name}, show them who is the boss here!!</h3>
                <h3 id="h3">
                    {statusText}
                    {gameOver && !showResult && (
                        <button style={{ ...S.btnGhost, marginLeft: 12, padding: '2px 10px' }}
                                onClick={() => setShowResult(true)}>Show results</button>
                    )}
                </h3>

                {/* SVG board layer (replaces the old <canvas>); keeps id="myCanvas" so existing CSS still applies */}
                <svg
                    id="myCanvas"
                    ref={svgRef}
                    width={vp.w}
                    height={Math.max(vp.h - vhToPixels(9), 0)}
                    style={{
                        // same job the old `.houseBlockContainer canvas` CSS rule did: lift the layer out of the
                        // flex flow so its height can't push the board and panels down the page
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        zIndex: -1,
                        overflow: 'visible',
                        pointerEvents: 'none'
                    }}
                    aria-hidden="true"
                >
                    {/* claimed houses */}
                    {allJoined && houses.map((h) => {
                        const g = boxGeometry(h.corners);
                        if (!g) return null;
                        const x = g.tl.x - o.x + g.pad, y = g.tl.y - o.y + g.pad;
                        const w = g.w - 2 * g.pad, hh = g.h - 2 * g.pad;
                        return (
                            <g key={h.key}>
                                <title>{h.name}</title>
                                <rect x={x} y={y} width={w} height={hh} rx={8}
                                      fill={h.color} fillOpacity={0.18} stroke={h.color} strokeOpacity={0.6} />
                                <image href={avatarSrc(h.avatar)} x={x + 4} y={y + 4}
                                       width={Math.max(w - 8, 0)} height={Math.max(hh - 8, 0)}
                                       preserveAspectRatio="xMidYMid meet" />
                            </g>
                        );
                    })}

                    {/* lines: centre of one dot to centre of the other, in the svg's own coordinates */}
                    {allJoined && edges.map(([a, b]) => {
                        const p = layout.dots[a], q = layout.dots[b];
                        if (!p || !q) return null;
                        const k = edgeKey(a, b);
                        const isLast = k === lastKey;
                        return (
                            <line key={k}
                                  x1={p.x - o.x} y1={p.y - o.y} x2={q.x - o.x} y2={q.y - o.y}
                                  stroke={isLast ? '#e8590c' : '#1e1e2f'}
                                  strokeWidth={isLast ? 4 : 3}
                                  strokeLinecap="round" />
                        );
                    })}
                </svg>

                <div className="others" id="others">
                    <textarea id="linkText" rows='1' disabled defaultValue={window.location.href}></textarea>
                    <button onClick={() => copyLink()} className="copyLink">Copy Link</button>

                    <div className="playersInfo">
                        <h5>Players joined ({playersData.length}):-</h5>
                        {allJoined && <h5>Houses: {claimed} / {totalHouses}</h5>}
                        <table>
                            <tbody>
                            {scores.map((s) => {
                                const isTurn = allJoined && !gameOver && sameId(firebaseData.currentChance, s.deviceId);
                                return (
                                    <tr key={s.deviceId}
                                        style={isTurn ? { background: 'rgba(255, 212, 59, 0.35)' } : undefined}>
                                        <td>
                                            <li style={{ color: s.color, fontWeight: 600 }}>
                                                {s.name}{sameId(s.deviceId, deviceId) ? ' (you)' : ''}
                                            </li>
                                        </td>
                                        <td><img src={avatarSrc(s.avatar)} id={`img_` + s.deviceId} height='50' width='auto' alt="" /></td>
                                        {allJoined && <td><strong>{s.points}</strong>{isTurn ? ' ◀' : ''}</td>}
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <h1 id="pnj" style={{ display: allJoined ? 'none' : '' }}>
                    Not all players are joined. Copy the link and share it with friends.
                </h1>

                <div id="button_parent" style={{
                    gridTemplateColumns: `repeat(${no}, 1fr)`,
                    gridTemplateRows: `repeat(${no}, 1fr)`,
                    display: allJoined ? '' : 'none'
                }}>
                    {Array.from({ length: no * no }, (_, i) => (
                        <Button key={i} id={i}
                                selected={selected === i}
                                disabled={dotDisabled(i)}
                                onSelect={handleDotClick} />
                    ))}
                </div>

                <div className="others">
                    {
                        // ads..
                    }
                </div>

            </div>

            {/* "Select" buttons for houses the player just closed */}
            {visiblePending.length > 0 && createPortal(
                <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
                    {visiblePending.map((box) => {
                        const g = boxGeometry(box);
                        if (!g) return null;
                        return (
                            <button key={box.join(',')}
                                    disabled={busy}
                                    onClick={() => claimHouse(box)}
                                    style={{
                                        ...S.selectBtn,
                                        left: g.tl.x + g.pad, top: g.tl.y + g.pad,
                                        width: g.w - 2 * g.pad, height: g.h - 2 * g.pad
                                    }}>
                                Select
                            </button>
                        );
                    })}
                </div>,
                document.body
            )}

            {/* result screen */}
            {gameOver && showResult && createPortal(
                <div style={S.backdrop} role="dialog" aria-modal="true" aria-label="Game result">
                    <div style={S.card} ref={resultRef}>

                        <div style={{ fontSize: 44, lineHeight: 1 }}>{isTie ? '🤝' : '🏆'}</div>
                        <h2 style={{ margin: '8px 0 4px' }}>{headline}</h2>
                        <p style={{ margin: 0, opacity: 0.75 }}>{subline}</p>

                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '14px 0 0' }}>
                            {winners.map((w) => (
                                <img key={w.deviceId} src={avatarSrc(w.avatar)} alt={w.name} height="80" width="auto" />
                            ))}
                        </div>

                        <table style={S.table}>
                            <thead>
                            <tr>
                                <th style={S.td}>#</th>
                                <th style={S.td} colSpan="2">Player</th>
                                <th style={S.td}>Houses</th>
                            </tr>
                            </thead>
                            <tbody>
                            {ranked.map((s) => {
                                const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank;
                                return (
                                    <tr key={s.deviceId}
                                        style={{ background: s.rank === 1 ? 'rgba(255, 212, 59, 0.35)' : undefined }}>
                                        <td style={S.td}>{medal}</td>
                                        <td style={S.td}><img src={avatarSrc(s.avatar)} alt="" height="36" width="auto" /></td>
                                        <td style={{ ...S.td, fontWeight: 600, color: s.color }}>
                                            {s.name}{sameId(s.deviceId, deviceId) ? ' (you)' : ''}
                                        </td>
                                        <td style={{ ...S.td, fontWeight: 700 }}>{s.points}</td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>

                        <div style={S.actions} data-html2canvas-ignore="true">
                            <button style={S.btn} onClick={saveResult}>Save result image</button>
                            <button style={S.btnGhost} onClick={() => setShowResult(false)}>View board</button>
                        </div>

                    </div>
                </div>,
                document.body
            )}
        </>
    );

};


const Button = ({ id, selected, disabled, onSelect }) => (
    <button
        id={id}
        className="button"
        disabled={disabled}
        onClick={() => onSelect(id)}
        style={{
            backgroundColor: selected ? '#e8590c' : disabled ? 'rgba(30, 30, 47, 0.19)' : 'rgba(30, 30, 47, 0.824)',
            transform: selected ? 'scale(1.35)' : undefined,
            transition: 'transform 0.12s ease'
        }}
    ></button>
);
