
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

export interface CompanyInput {
  originalIndex: number;
  companyName?: string;
  country?: string;
  website?: string;
}

export interface CompanyMetadata {
  summary?: string;
  independenceCriteria?: string;
  insufficientInformation?: string;
  [key: string]: any; // Allows for other potential metadata fields
}

export interface CompanyMatchResult {
  originalIndex: number;
  matched: boolean;
  metadata?: CompanyMetadata;
  error?: string;
}

export const checkForExistingCompaniesCallable = 
  httpsCallable<{ companies: CompanyInput[] }, { results: CompanyMatchResult[] }>(
    functionsInstance, 
    'checkForExistingCompanies'
  );

export interface ScrapeWebsiteInput {
  url: string;
}

// This result should align with the Python function's return structure
export interface ScrapeWebsiteResult {
  status: 'success' | 'error' | 'failed_fetch' | 'failed_parse' | 'short' | 'content_too_short' | 'not_found';
  content?: string; // Present on success
  source_url?: string;
  method?: string;
  message?: string; // Present on error or specific statuses
  reason?: string; // Present on error status
  // Potentially other fields depending on the python function's full output for various cases
}


export const scrapeWebsiteContentCallable = 
  httpsCallable<ScrapeWebsiteInput, ScrapeWebsiteResult>(
    functionsInstance, 
    'scrape_website_content' // Ensure this matches the deployed Python function name
  );

// This should match the return type of the summarizeCompanyContent Firebase Function
export interface SummarizeCompanyContentResult {
    status: "success" | "error";
    summary?: string;
    independenceCriteria?: string;
    insufficientInformation?: string;
    message?: string; // For errors
}

export const summarizeCompanyContentCallable = 
  httpsCallable<{content: string}, SummarizeCompanyContentResult>(
    functionsInstance, 
    'summarizeCompanyContent'
  );

export interface SaveCompanyEntryData {
  companyName?: string;
  country?: string;
  website?: string; // Should be the normalized URL
  metadata: CompanyMetadata;
}

export const saveCompanyEntryCallable = 
  httpsCallable<SaveCompanyEntryData, { success: boolean }>(
    functionsInstance, 
    'saveCompanyEntry'
  );
