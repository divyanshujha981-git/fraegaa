import  { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import './house_block.css';
import { useNavigate } from "react-router-dom";
import { firestore } from "../../firebase";
import { arrayUnion, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import html2canvas from "html2canvas";
import {HOUSE_BLOCK, ID, PLAYERS_INFO} from "../../other_assets/helpers/constants.jsx";


/* ------------------------------------------------------------------ */
/*  Module state + small helpers                                      */
/* ------------------------------------------------------------------ */

const mapNode = new Map();      // dot -> Set of connected dots

let deviceId;
let gameId;

const OWNER_COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599'];

// first few are hand-picked; beyond that, spread hues around the colour wheel so any player count stays distinct
const ownerColor = (i) => (i < OWNER_COLORS.length ? OWNER_COLORS[i] : `hsl(${Math.round((i * 137.5) % 360)}, 65%, 45%)`);

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

const areAdjacent = (a, b, n) =>
    Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n)) === 1;

function avatarSrc(avatar) {
    try {
        return new URL(`../../other_assets/images/c${avatar}.png`, import.meta.url).href;
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
const storageKey = () => `mapData_${gameId}`;

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
/*  Firestore                                                         */
/* ------------------------------------------------------------------ */

async function changeChance(playersData) {

    const current = playersData.findIndex((p) => sameId(p.deviceId, deviceId));
    if (current === -1) return;

    const nextDeviceId = playersData[(current + 1) % playersData.length].deviceId;

    try {
        await updateDoc(doc(firestore, HOUSE_BLOCK, gameId + ""), { currentChance: nextDeviceId });
    } catch (error) {
        console.error("Error updating document: ", error);
    }

}

async function dotsConnectedFirebase(p1, p2) {
    try {
        await updateDoc(doc(firestore, HOUSE_BLOCK, gameId + ""), { dotsConnected: p1 + "_" + p2 });
        return true;
    } catch (error) {
        console.error("Error updating document: ", error);
        return false;
    }
}

async function addOccupiedToFirebase(houseString) {
    try {
        await updateDoc(doc(firestore, HOUSE_BLOCK, gameId + "", PLAYERS_INFO, deviceId + ""), {
            occupied: arrayUnion(houseString)
        });
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

function subscribeToGame(gameId, onGame, onPlayers) {

    const parentDocRef = doc(firestore, HOUSE_BLOCK, gameId + "");

    const unsubGame = onSnapshot(parentDocRef, (snap) => {
        if (snap.exists()) onGame(snap.data());
    });

    const unsubPlayers = onSnapshot(collection(parentDocRef, PLAYERS_INFO), (snap) => {
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

function sameLayout(a, b) {
    if (Math.abs(a.origin.x - b.origin.x) > 0.5 || Math.abs(a.origin.y - b.origin.y) > 0.5) return false;
    if (a.dots.length !== b.dots.length) return false;
    return a.dots.every((d, i) => {
        const e = b.dots[i];
        if (!d || !e) return d === e;
        return Math.abs(d.x - e.x) <= 0.5 && Math.abs(d.y - e.y) <= 0.5;
    });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const HouseBlock = () => {

    const navigate = useNavigate();

    gameId = new URLSearchParams(window.location.search).get(ID);

    try {
        deviceId = JSON.parse(localStorage.getItem(HOUSE_BLOCK)).deviceId || null;
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
    const [copied, setCopied] = useState(false);

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
        if (!deviceId) navigate(`/houseblock/pregame_definition?id=${gameId}`);
        // eslint-disable-next-line
    }, []);

    useEffect(() => {
        mapNode.clear();
        loadMap();
        setEdges(getEdges());

        return subscribeToGame(
            gameId,
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
            navigate(`/houseblock/pregame_definition?id=${gameId}`);
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


    const copyLink = async () => {
        try {
            await window.navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            alert('Failed to copy link');
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

                <div className="hb_header">
                    <p className="hb_welcome" id="h3">Welcome {myData.name}, show them who is the boss here!!</p>
                    {statusText && (
                        <div className={`status${(isMyTurn || visiblePending.length > 0) && !gameOver ? ' is_mine' : ''}${gameOver ? ' is_over' : ''}`}
                             role="status">
                            {statusText}
                            {gameOver && !showResult && (
                                <button className="btn btn_ghost btn_small" onClick={() => setShowResult(true)}>Show results</button>
                            )}
                        </div>
                    )}
                </div>

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

                <aside className="others panel" id="others">

                    <div className="panel_section">
                        <span className="panel_label">Invite friends</span>
                        <div className="link_row">
                            <input id="linkText" className="link_input" readOnly value={window.location.href}
                                   onFocus={(e) => e.target.select()} />
                            <button onClick={copyLink} className="btn btn_small copyLink">{copied ? 'Copied ✓' : 'Copy'}</button>
                        </div>
                    </div>

                    <div className="playersInfo panel_section">
                        <div className="panel_label_row">
                            <span className="panel_label">Players ({playersData.length}/{firebaseData.playerNo})</span>
                            {allJoined && <span className="panel_label">Houses {claimed}/{totalHouses}</span>}
                        </div>
                        <div className="player_list">
                            {scores.map((s) => {
                                const isTurn = allJoined && !gameOver && sameId(firebaseData.currentChance, s.deviceId);
                                return (
                                    <div key={s.deviceId} className={`player_row${isTurn ? ' is_turn' : ''}`}>
                                        <img className="player_avatar" src={avatarSrc(s.avatar)} id={`img_` + s.deviceId} alt="" />
                                        <span className="player_name" style={{ color: s.color }}>
                                            {s.name}{sameId(s.deviceId, deviceId) ? ' (you)' : ''}
                                        </span>
                                        {isTurn && <span className="turn_dot" title="Playing now" />}
                                        {allJoined && <strong className="player_points">{s.points}</strong>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </aside>

                <div id="pnj" className="waiting" style={{ display: allJoined ? 'none' : '' }}>
                    <div className="waiting_spinner" />
                    <h2>Waiting for players…</h2>
                    <p>{playersData.length} of {firebaseData.playerNo} joined. Copy the link and share it with friends.</p>
                </div>

                <div id="button_parent" style={{
                    gridTemplateColumns: `repeat(${no}, 1fr)`,
                    gridTemplateRows: `repeat(${no}, 1fr)`,
                    display: allJoined ? '' : 'none'
                }}>
                    {Array.from({ length: no * no }, (_, i) => {
                        const off = dotDisabled(i);
                        return (
                            <Button key={i} id={i}
                                    selected={selected === i}
                                    target={selected !== null && selected !== i && !off}
                                    disabled={off}
                                    onSelect={handleDotClick} />
                        );
                    })}
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
                                    className="claim_btn"
                                    style={{
                                        left: g.tl.x + g.pad, top: g.tl.y + g.pad,
                                        width: g.w - 2 * g.pad, height: g.h - 2 * g.pad
                                    }}>
                                Claim ✓
                            </button>
                        );
                    })}
                </div>,
                document.body
            )}

            {/* result screen */}
            {gameOver && showResult && createPortal(
                <div className="result_backdrop" role="dialog" aria-modal="true" aria-label="Game result">
                    <div className="result_card" ref={resultRef}>

                        <div className="result_emoji">{isTie ? '🤝' : '🏆'}</div>
                        <h2 className="result_title">{headline}</h2>
                        <p className="result_sub">{subline}</p>

                        <div className="result_winners">
                            {winners.map((w) => (
                                <img key={w.deviceId} className="result_avatar" src={avatarSrc(w.avatar)} alt={w.name} />
                            ))}
                        </div>

                        <div className="result_list">
                            <div className="result_row result_head">
                                <span>#</span><span></span><span>Player</span><span>Houses</span>
                            </div>
                            {ranked.map((s) => {
                                const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank;
                                return (
                                    <div key={s.deviceId} className={`result_row${s.rank === 1 ? ' is_winner' : ''}`}>
                                        <span className="result_rank">{medal}</span>
                                        <img className="result_row_avatar" src={avatarSrc(s.avatar)} alt="" />
                                        <span className="result_name" style={{ color: s.color }}>
                                            {s.name}{sameId(s.deviceId, deviceId) ? ' (you)' : ''}
                                        </span>
                                        <span className="result_points">{s.points}</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="result_actions" data-html2canvas-ignore="true">
                            <button className="btn" onClick={saveResult}>Save result image</button>
                            <button className="btn btn_ghost" onClick={() => setShowResult(false)}>View board</button>
                        </div>

                    </div>
                </div>,
                document.body
            )}
        </>
    );

};


const Button = ({ id, selected, target, disabled, onSelect }) => (
    <button
        id={id}
        className={`button${selected ? ' is_selected' : ''}${target ? ' is_target' : ''}`}
        disabled={disabled}
        onClick={() => onSelect(id)}
        aria-label={`Dot ${id + 1}`}
    ></button>
);
