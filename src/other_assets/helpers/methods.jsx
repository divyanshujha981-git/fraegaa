import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { firestore } from "../../firebase";
import {PLAYERS_INFO} from "./constants.jsx";


export function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}


export function readDeviceId(GAME_NAME) {
    try {
        return JSON.parse(localStorage.getItem(GAME_NAME)).deviceId || null;
    } catch {
        return null;
    }
}


export async function deleteSession(gameId, gameName) {
    try {
        const gameRef = doc(firestore, gameName, gameId);
        const players = await getDocs(collection(gameRef, PLAYERS_INFO));
        const batch = writeBatch(firestore);
        players.docs.forEach((d) => batch.delete(d.ref));   // deleting a doc doesn't delete its sub-collection
        batch.delete(gameRef);
        await batch.commit();
    } catch (e) {
        console.error("Error deleting game session: ", e);
    }
}
