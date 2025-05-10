
'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { parseXLSX, type ParsedXLSXData } from '@/lib/xlsx-parser';
import { normalizeUrl } from '@/lib/url-normalizer';
import { detectHeaders, type DetectHeadersInput, type DetectHeadersOutput } from '@/ai/flows/detect-headers';
import { checkForExistingCompaniesCallable, type CompanyInput, type CompanyMatchResult, type CompanyMetadata } from '@/lib/firebase';

import { FileUploadArea } from '@/components/overviewer/FileUploadArea';
import { ResultsDisplay, type TableDataRow as ResultsTableDataRow } from '@/components/overviewer/ResultsDisplay';
import { LoadingIndicator } from '@/components/overviewer/LoadingIndicator';
import { ErrorMessage } from '@/components/overviewer/ErrorMessage';
import { useToast } from '@/hooks/use-toast';

// Extend TableDataRow to include new metadata fields and processingStatus
interface TableDataRow extends ResultsTableDataRow {
  processingStatus: 'Fetched' | 'To Process';
  // summary, independenceCriteria, insufficientInformation are already in ResultsTableDataRow
}

interface ProcessedData {
  fileName: string;
  originalHeaders: string[];
  mappedHeaders: DetectHeadersOutput;
  tableData: TableDataRow[]; // Uses the extended TableDataRow from ResultsDisplay
}

export default function OverviewerPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
  const { toast } = useToast();

  const processFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile) return;

    setIsLoading(true);
    setError(null);
    setProcessedData(null);

    try {
      const { headers: rawHeaders, data: rawDataRows }: ParsedXLSXData = await parseXLSX(selectedFile);

      if (rawHeaders.length === 0) {
        setError("The uploaded file seems to be empty or doesn't have a valid header row.");
        setIsLoading(false);
        return;
      }
      
      const aiInput: DetectHeadersInput = { headers: rawHeaders };
      const detectedHeaders = await detectHeaders(aiInput);

      const companyNameHeader = detectedHeaders.companyName;
      const countryHeader = detectedHeaders.country;
      const websiteHeader = detectedHeaders.website;

      const companyNameHeaderIdx = companyNameHeader ? rawHeaders.indexOf(companyNameHeader) : -1;
      const countryHeaderIdx = countryHeader ? rawHeaders.indexOf(countryHeader) : -1;
      const websiteHeaderIdx = websiteHeader ? rawHeaders.indexOf(websiteHeader) : -1;

      const companiesToCheck: CompanyInput[] = rawDataRows.map((row, index) => {
        const companyName = companyNameHeaderIdx !== -1 && row[companyNameHeaderIdx] ? String(row[companyNameHeaderIdx]).trim() : undefined;
        const country = countryHeaderIdx !== -1 && row[countryHeaderIdx] ? String(row[countryHeaderIdx]).trim() : undefined;
        const website = websiteHeaderIdx !== -1 && row[websiteHeaderIdx] ? String(row[websiteHeaderIdx]).trim() : undefined;
        
        return {
          originalIndex: index,
          companyName: companyName,
          country: country,
          website: website,
        };
      });

      let companyMatchResults: CompanyMatchResult[] = [];
      if (companiesToCheck.length > 0) {
        try {
            const { data: functionResult } = await checkForExistingCompaniesCallable({ companies: companiesToCheck });
            companyMatchResults = functionResult.results;
        } catch (fbError: any) {
            console.error("Firebase function error:", fbError);
            toast({
                title: "Database Check Error",
                description: `Could not check for existing company records: ${fbError.message}. Proceeding without pre-fetched data.`,
                variant: "destructive",
            });
            companyMatchResults = companiesToCheck.map(c => ({ originalIndex: c.originalIndex, matched: false }));
        }
      }
      
      const companyResultsMap = new Map(companyMatchResults.map(r => [r.originalIndex, r]));

      const tableData: TableDataRow[] = rawDataRows.map((row, index) => {
        const companyNameVal = companyNameHeaderIdx !== -1 && row[companyNameHeaderIdx] ? String(row[companyNameHeaderIdx]).trim() : undefined;
        const websiteVal = websiteHeaderIdx !== -1 && row[websiteHeaderIdx] ? String(row[websiteHeaderIdx]).trim() : undefined;
        
        const normalizedWebsite = normalizeUrl(websiteVal);
        
        const displayRowValues = [...row.map(String)]; 
        if (websiteHeaderIdx !== -1 && normalizedWebsite && normalizedWebsite !== String(row[websiteHeaderIdx]).trim().toLowerCase()) {
           displayRowValues[websiteHeaderIdx] = normalizedWebsite;
        }

        const hasError = !companyNameVal || !normalizedWebsite;

        const matchInfo = companyResultsMap.get(index);
        const processingStatus = matchInfo?.matched ? 'Fetched' : 'To Process';
        
        if (matchInfo?.error) {
          console.warn(`Error for row ${index} from Firebase function: ${matchInfo.error}`);
        }
        
        const metadata: CompanyMetadata | undefined = matchInfo?.metadata;

        return {
          id: `row-${index}`,
          values: displayRowValues,
          hasError,
          processingStatus,
          summary: metadata?.summary,
          independenceCriteria: metadata?.independenceCriteria,
          insufficientInformation: metadata?.insufficientInformation,
        };
      });

      setProcessedData({
        fileName: selectedFile.name,
        originalHeaders: rawHeaders,
        mappedHeaders: detectedHeaders,
        tableData,
      });

      toast({
        title: "File Processed",
        description: `Analyzed ${selectedFile.name}. Review data and processing status.`,
      });

    } catch (e: any) {
      console.error("Processing error:", e);
      setError(e.message || "An unknown error occurred during file processing.");
      toast({
        title: "Processing Error",
        description: e.message || "Could not process the file.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    processFile(selectedFile);
  };
  
  const handleProcessAnotherFile = () => {
    setFile(null);
    setProcessedData(null);
    setError(null);
    setIsLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-4 sm:p-8 md:p-12 bg-background">
      <div className="w-full max-w-5xl space-y-8">
        <header className="text-center">
          <h1 className="text-4xl font-bold text-primary tracking-tight">Overviewer</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Upload your XLSX file to intelligently detect headers, normalize data, and preview insights.
          </p>
        </header>

        {isLoading && <LoadingIndicator />}
        {error && !isLoading && <ErrorMessage message={error} />}

        {!processedData && !isLoading && !error && (
          <FileUploadArea onFileSelect={handleFileSelect} isProcessing={isLoading} />
        )}

        {processedData && !isLoading && (
          <div className="space-y-6">
            <ResultsDisplay
              fileName={processedData.fileName}
              originalHeaders={processedData.originalHeaders}
              mappedHeaders={processedData.mappedHeaders}
              tableData={processedData.tableData}
            />
            <div className="text-center">
              <Button onClick={handleProcessAnotherFile} variant="outline" size="lg">
                Process Another File
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
