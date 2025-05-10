import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const functionsInstance: Functions = getFunctions(app);

// Define types for callable function arguments and return value (mirroring Cloud Function)
export interface CompanyInput {
  originalIndex: number;
  companyName?: string;
  country?: string;
  website?: string;
}

export interface CompanyMatchResult {
  originalIndex: number;
  matched: boolean;
  metadata?: any;
  error?: string;
}

export const checkForExistingCompaniesCallable = 
  httpsCallable<{ companies: CompanyInput[] }, { results: CompanyMatchResult[] }>(
    functionsInstance, 
    'checkForExistingCompanies'
  );
