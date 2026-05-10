import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAZsAedGyfht5BkhCQIDIs-C9kd1FGX_xk",
  authDomain: "tamagochi-db43c.firebaseapp.com",
  projectId: "tamagochi-db43c",
  storageBucket: "tamagochi-db43c.firebasestorage.app",
  messagingSenderId: "112434093959",
  appId: "1:112434093959:web:e4932ef9f8254ba243bd22"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
