'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { parseXLSX, type ParsedXLSXData } from '@/lib/xlsx-parser';
import { normalizeUrl } from '@/lib/url-normalizer';
import { detectHeaders, type DetectHeadersInput, type DetectHeadersOutput } from '@/ai/flows/detect-headers';

import { FileUploadArea } from '@/components/overviewer/FileUploadArea';
import { ResultsDisplay, type TableDataRow } from '@/components/overviewer/ResultsDisplay';
import { LoadingIndicator } from '@/components/overviewer/LoadingIndicator';
import { ErrorMessage } from '@/components/overviewer/ErrorMessage';
import { useToast } from '@/hooks/use-toast';

interface ProcessedData {
  fileName: string;
  originalHeaders: string[];
  mappedHeaders: DetectHeadersOutput;
  tableData: TableDataRow[];
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
      const websiteHeader = detectedHeaders.website;

      const companyNameIdx = companyNameHeader ? rawHeaders.indexOf(companyNameHeader) : -1;
      const websiteIdx = websiteHeader ? rawHeaders.indexOf(websiteHeader) : -1;

      const tableData: TableDataRow[] = rawDataRows.map((row, index) => {
        const companyName = companyNameIdx !== -1 && row[companyNameIdx] ? String(row[companyNameIdx]).trim() : undefined;
        const websiteVal = websiteIdx !== -1 && row[websiteIdx] ? String(row[websiteIdx]).trim() : undefined;
        
        const normalizedWebsite = normalizeUrl(websiteVal);
        
        const updatedRowValues = [...row];
        if (websiteIdx !== -1 && normalizedWebsite !== websiteVal && typeof normalizedWebsite === 'string') {
           updatedRowValues[websiteIdx] = normalizedWebsite;
        } else if (websiteIdx !== -1 && typeof websiteVal === 'string' && typeof normalizedWebsite === 'undefined') {
          // If URL was invalid after normalization, keep original or mark as invalid. For now, keep original if it existed.
          // Or, if you want to clear invalid URLs: updatedRowValues[websiteIdx] = '';
        }


        const hasError = !companyName || !normalizedWebsite;

        return {
          id: `row-${index}`,
          values: updatedRowValues.map(String), // Ensure all values are strings
          hasError,
        };
      });

      setProcessedData({
        fileName: selectedFile.name,
        originalHeaders: rawHeaders,
        mappedHeaders: detectedHeaders,
        tableData,
      });

      toast({
        title: "File Processed Successfully",
        description: `Detected headers and data for ${selectedFile.name}.`,
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
    // Automatically process if a new file is selected
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
