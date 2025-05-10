'use strict';
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
  metadata?: any;
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
    
    // If no fields to query by, skip to avoid error (though caught by all-null check above)
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
        metadata: foundMatchData ? foundMatchData.metadata : undefined,
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
  const metadata = data.metadata;

  const normalizedCompanyName = originalCompanyName ? originalCompanyName.trim().toLowerCase() : undefined;
  const normalizedCountry = originalCountry ? originalCountry.trim().toLowerCase() : undefined;
  const normalizedWebsite = normalizeUrlInternal(originalWebsite);

  // Ensure at least one required field is present after normalization
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
    metadata: metadata || {}, // Store metadata, default to empty object if not provided
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (normalizedCompanyName) companyData.normalizedCompanyName = normalizedCompanyName;
  if (normalizedCountry) companyData.normalizedCountry = normalizedCountry;
  if (normalizedWebsite) companyData.website = normalizedWebsite; // Using 'website' as the field name for the normalized website

  try {
    await db.collection('companies').add(companyData);
    return { success: true };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Error saving company entry.', error);
  }
});
