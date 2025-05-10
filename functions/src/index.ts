
'use strict';
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { summarizeContent, type SummarizeContentInput, type SummarizeContentOutput, UNUSABLE_CONTENT_RESPONSE } from './summarize-flow';


admin.initializeApp();
const db = admin.firestore();

function normalizeUrlInternal(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }

  let normalized = url.trim().toLowerCase();

  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  
  try {
    new URL(normalized); // This will throw an error if the URL is invalid
  } catch (e) {
    return undefined; 
  }

  return normalized;
}


interface CompanyInputData {
  originalIndex: number;
  companyName?: string;
  country?: string;
  website?: string;
}

interface CompanyMatchOutput {
  originalIndex: number;
  matched: boolean;
  metadata?: {
    summary?: string;
    independenceCriteria?: string;
    insufficientInformation?: string;
    [key: string]: any; // Keep it flexible for other metadata
  };
  error?: string;
}

export const checkForExistingCompanies = functions.https.onCall(async (data: { companies: CompanyInputData[] }, context) => {
  const companies = data.companies;
  if (!Array.isArray(companies)) {
    throw new functions.https.HttpsError('invalid-argument', 'Expected "companies" to be an array.');
  }

  // Approximately 6 months ago
  const sixMonthsAgoDate = new Date();
  sixMonthsAgoDate.setMonth(sixMonthsAgoDate.getMonth() - 6);
  const sixMonthsAgoTimestamp = admin.firestore.Timestamp.fromDate(sixMonthsAgoDate);

  const results: CompanyMatchOutput[] = [];

  for (const company of companies) {
    const normName = company.companyName ? company.companyName.trim().toLowerCase() : null;
    const normCountry = company.country ? company.country.trim().toLowerCase() : null;
    const normWebsite = company.website ? normalizeUrlInternal(company.website) : null;

    if (!normName && !normCountry && !normWebsite) {
      results.push({ originalIndex: company.originalIndex, matched: false });
      continue;
    }

    const potentialDocsFromQueries = new Map<string, admin.firestore.DocumentData>();
    const queries: Promise<admin.firestore.QuerySnapshot>[] = [];

    if (normName) {
      queries.push(db.collection('companies').where('normalizedCompanyName', '==', normName).where('timestamp', '>=', sixMonthsAgoTimestamp).get());
    }
    if (normCountry) {
      queries.push(db.collection('companies').where('normalizedCountry', '==', normCountry).where('timestamp', '>=', sixMonthsAgoTimestamp).get());
    }
    if (normWebsite) {
      queries.push(db.collection('companies').where('website', '==', normWebsite).where('timestamp', '>=', sixMonthsAgoTimestamp).get());
    }
    
    if (queries.length === 0) {
        results.push({ originalIndex: company.originalIndex, matched: false });
        continue;
    }

    try {
      const querySnapshots = await Promise.all(queries);
      querySnapshots.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          if (doc.exists) {
            potentialDocsFromQueries.set(doc.id, doc.data());
          }
        });
      });

      let foundMatchData: admin.firestore.DocumentData | null = null;

      for (const dbDocData of potentialDocsFromQueries.values()) {
        let matchCount = 0;
        if (normName && dbDocData.normalizedCompanyName === normName) matchCount++;
        if (normCountry && dbDocData.normalizedCountry === normCountry) matchCount++;
        if (normWebsite && dbDocData.website === normWebsite) matchCount++;
    
        if (matchCount >= 2) {
          foundMatchData = dbDocData;
          break; 
        }
      }
      
      results.push({
        originalIndex: company.originalIndex,
        matched: !!foundMatchData,
        metadata: foundMatchData ? (foundMatchData.metadata as CompanyMatchOutput['metadata']) : undefined,
      });

    } catch (error: any) {
      functions.logger.error("Error processing company index:", company.originalIndex, "Input:", company, "Error:", error);
      results.push({ originalIndex: company.originalIndex, matched: false, error: error.message });
    }
  }
  return { results };
});

export const saveCompanyEntry = functions.https.onCall(async (data: any, context) => {
  const originalCompanyName = data.companyName;
  const originalCountry = data.country;
  const originalWebsite = data.website;
  
  // Metadata now includes summary, independenceCriteria, and insufficientInformation
  const metadata = data.metadata || {}; 

  const normalizedCompanyName = originalCompanyName ? originalCompanyName.trim().toLowerCase() : undefined;
  const normalizedCountry = originalCountry ? originalCountry.trim().toLowerCase() : undefined;
  const normalizedWebsite = normalizeUrlInternal(originalWebsite);

  if (!normalizedCompanyName && !normalizedCountry && !normalizedWebsite) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'At least one of companyName, country, or website must be provided and valid.'
    );
  }

  const companyData: { [key: string]: any } = {
    originalCompanyName,
    originalCountry,
    originalWebsite,
    metadata: { // Ensure all expected metadata fields are explicitly handled or passed through
        summary: metadata.summary || '',
        independenceCriteria: metadata.independenceCriteria || '',
        insufficientInformation: metadata.insufficientInformation || '',
        ...metadata // Pass through any other metadata fields
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (normalizedCompanyName) companyData.normalizedCompanyName = normalizedCompanyName;
  if (normalizedCountry) companyData.normalizedCountry = normalizedCountry;
  if (normalizedWebsite) companyData.website = normalizedWebsite;

  try {
    await db.collection('companies').add(companyData);
    return { success: true };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Error saving company entry.', error);
  }
});


export const summarizeCompanyContent = functions.https.onCall(async (data: { content: string }, context) => {
  functions.logger.info('summarizeCompanyContent called with content length:', data?.content?.length);

  if (!data || typeof data.content !== 'string' || data.content.trim() === '') {
    functions.logger.error('Invalid input: content must be a non-empty string.');
    throw new functions.https.HttpsError('invalid-argument', 'The function must be called with an object containing a "content" string field.');
  }

  const { content } = data;

  try {
    const input: SummarizeContentInput = { content };
    functions.logger.info('Calling Genkit summarizeContentFlow with input:', { 
      contentLength: content.length, 
      contentSnippet: content.substring(0, 100) + (content.length > 100 ? '...' : '') 
    });

    const result: SummarizeContentOutput = await summarizeContent(input);
    
    functions.logger.info('Genkit summarizeContentFlow returned:', result);

    // The Genkit flow now directly provides all fields including handling of UNUSABLE_CONTENT_RESPONSE.
    // The status is "success" if the flow executed, regardless of content usability.
    return { 
        status: "success", 
        summary: result.summary,
        independenceCriteria: result.independenceCriteria,
        insufficientInformation: result.insufficientInformation
    };

  } catch (error: any)
 {
    functions.logger.error('Error calling or processing summarizeContentFlow:', error);
    let errorMessage = 'An unexpected error occurred while summarizing content.';
    if (error.message) {
      errorMessage = error.message;
    }
    throw new functions.https.HttpsError('internal', errorMessage, error.details || { originalError: error.message });
  }
});
