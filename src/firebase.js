// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import firebase from "firebase/compat/app";
 import { getDatabase } from "firebase/database";
 import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCO5tNFyhPUWzX92-5Tenbv_OLdstYAQ7c",
  authDomain: "gaming-friends-5043e.firebaseapp.com",
  projectId: "gaming-friends-5043e",
  storageBucket: "gaming-friends-5043e.firebasestorage.app",
  messagingSenderId: "435314215627",
  appId: "1:435314215627:web:8de8215e3279e2f29c294e",
  measurementId: "G-W193B1RLGS"
};

// // Initialize Firebase
 const app = initializeApp(firebaseConfig);
//initializeApp(firebaseConfig);

const realtimeDatabase = getDatabase(app);
const firestore = getFirestore(app);


//const analytics = getAnalytics(app);

export  {realtimeDatabase, firestore};