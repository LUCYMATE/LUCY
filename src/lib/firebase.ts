import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDHU3OKXMmCTJf_168YJDardJFTJHtKCoA",
  authDomain: "packgame.firebaseapp.com",
  projectId: "packgame",
  storageBucket: "packgame.firebasestorage.app",
  messagingSenderId: "733837827623",
  appId: "1:733837827623:web:ccce44413b47c0fcaf7802",
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app, "ai-studio-9f26d830-09d4-4144-a1f3-8ebf4e2ee03a");
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const signOut = async () => {
  try {
    await fbSignOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};
