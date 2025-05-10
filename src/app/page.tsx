
'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { parseXLSX, type ParsedXLSXData } from '@/lib/xlsx-parser';
import { normalizeUrl } from '@/lib/url-normalizer';
import { detectHeaders, type DetectHeadersInput, type DetectHeadersOutput } from '@/ai/flows/detect-headers';
import { 
  checkForExistingCompaniesCallable, 
  type CompanyInput, 
  type CompanyMatchResult, 
  type CompanyMetadata,
  scrapeWebsiteContentCallable,
  summarizeCompanyContentCallable,
  saveCompanyEntryCallable,
  type SaveCompanyEntryData
} from '@/lib/firebase';
import * as XLSX from 'xlsx';
import { Loader2, Zap } from 'lucide-react';

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
  const [isExporting, setIsExporting] = useState(false);
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);
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
    setIsExporting(false);
    setIsAutoProcessing(false);
  };

  const handleExportResults = () => {
    if (!processedData) return;
    setIsExporting(true);

    try {
      const { originalHeaders, mappedHeaders, tableData } = processedData;

      const companyNameIdx = mappedHeaders.companyName ? originalHeaders.indexOf(mappedHeaders.companyName) : -1;
      const countryIdx = mappedHeaders.country ? originalHeaders.indexOf(mappedHeaders.country) : -1;
      const websiteIdx = mappedHeaders.website ? originalHeaders.indexOf(mappedHeaders.website) : -1;

      const exportableData = tableData
        .filter(row => !row.hasError) 
        .map((row, index) => ({
          'S. No.': index + 1,
          'Company Name': companyNameIdx !== -1 ? (row.values[companyNameIdx] || '') : '',
          'Country': countryIdx !== -1 ? (row.values[countryIdx] || '') : '',
          'Website': websiteIdx !== -1 ? (row.values[websiteIdx] || '') : '',
          'Overview': row.summary || '',
          'Independence Criteria': row.independenceCriteria || '',
          'Insufficient Information': row.insufficientInformation || '',
        }));

      if (exportableData.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no valid rows to export.",
          variant: "default",
        });
        setIsExporting(false);
        return;
      }
      
      const worksheet = XLSX.utils.json_to_sheet(exportableData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
      XLSX.writeFile(workbook, 'overviewer_results.xlsx');

      toast({
        title: "Export Successful",
        description: "Results downloaded as overviewer_results.xlsx",
      });

    } catch (e: any) {
      console.error("Export error:", e);
      setError(e.message || "An unknown error occurred during export.");
      toast({
        title: "Export Error",
        description: e.message || "Could not export the data.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };


  const handleAutoProcess = async () => {
    if (!processedData) return;

    setIsAutoProcessing(true);

    const rowsToProcessInitially = processedData.tableData.filter(
      (row) => row.processingStatus === 'To Process' && !row.hasError
    );

    if (rowsToProcessInitially.length === 0) {
      toast({ title: "No Rows to Process", description: "All eligible rows have been processed or fetched." });
      setIsAutoProcessing(false);
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    const companyNameHeaderIdx = processedData.mappedHeaders.companyName ? processedData.originalHeaders.indexOf(processedData.mappedHeaders.companyName) : -1;
    const countryHeaderIdx = processedData.mappedHeaders.country ? processedData.originalHeaders.indexOf(processedData.mappedHeaders.country) : -1;
    const websiteHeaderIdx = processedData.mappedHeaders.website ? processedData.originalHeaders.indexOf(processedData.mappedHeaders.website) : -1;

    const updatedTableDataPromises = processedData.tableData.map(async (row) => {
      if (row.processingStatus !== 'To Process' || row.hasError) {
        return row;
      }

      const website = websiteHeaderIdx !== -1 ? row.values[websiteHeaderIdx] : undefined;

      if (!website) {
        console.warn(`Skipping row ${row.id} (Company: ${row.values[companyNameHeaderIdx] || 'N/A'}) due to missing website.`);
        errorCount++;
        // Optionally, update row status to indicate this specific failure if desired
        // return { ...row, processingStatus: 'Error', processingError: 'Missing website for auto-processing' };
        return row; // Keep as 'To Process' or handle as an error state
      }

      try {
        console.log(`Auto-processing: ${website}`);
        const scrapeResult = await scrapeWebsiteContentCallable({ url: website });

        if (scrapeResult.data.status !== 'success' || !scrapeResult.data.content) {
          console.warn(`Scraping failed for ${website}: ${scrapeResult.data.message || scrapeResult.data.reason}`);
          errorCount++;
          return row;
        }

        const summarizeResult = await summarizeCompanyContentCallable({ content: scrapeResult.data.content });

        if (summarizeResult.data.status !== 'success' || !summarizeResult.data.summary) {
          console.warn(`Summarization failed for ${website}: ${summarizeResult.data.message}`);
          errorCount++;
          return row;
        }
        
        const companyNameVal = companyNameHeaderIdx !== -1 ? row.values[companyNameHeaderIdx] : undefined;
        const countryVal = countryHeaderIdx !== -1 ? row.values[countryHeaderIdx] : undefined;
        
        const companyDataForSave: SaveCompanyEntryData = {
          companyName: companyNameVal,
          country: countryVal,
          website: website,
          metadata: {
            summary: summarizeResult.data.summary,
            independenceCriteria: summarizeResult.data.independenceCriteria,
            insufficientInformation: summarizeResult.data.insufficientInformation,
          },
        };

        try {
            await saveCompanyEntryCallable(companyDataForSave);
        } catch(saveError: any) {
            console.error(`Failed to save entry for ${website}: ${saveError.message}`);
            // Decide if this should count as a full error or just a save error
            // For now, we proceed to update the row locally but log the save failure
        }

        successCount++;
        return {
          ...row,
          summary: summarizeResult.data.summary,
          independenceCriteria: summarizeResult.data.independenceCriteria,
          insufficientInformation: summarizeResult.data.insufficientInformation,
          processingStatus: 'Fetched',
        } as TableDataRow;

      } catch (e: any) {
        console.error(`Error auto-processing row ${row.id} for ${website}:`, e);
        errorCount++;
        return row;
      }
    });

    const newTableData = await Promise.all(updatedTableDataPromises);

    setProcessedData(prev => prev ? ({ ...prev, tableData: newTableData }) : null);
    
    toast({
      title: "Auto Processing Complete",
      description: `${successCount} rows processed successfully. ${errorCount} rows encountered errors or were skipped. Check console for details.`,
      duration: 7000,
    });
    setIsAutoProcessing(false);
  };


  const hasExportableData = processedData && processedData.tableData.some(row => !row.hasError);
  const canAutoProcess = processedData && 
                         !isLoading && 
                         !isAutoProcessing && 
                         !isExporting && 
                         processedData.tableData.some(row => row.processingStatus === 'To Process' && !row.hasError);

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
            {canAutoProcess && (
                 <div className="text-center">
                    <Button 
                        onClick={handleAutoProcess} 
                        disabled={isAutoProcessing || isLoading || isExporting}
                        size="lg"
                        className="bg-primary hover:bg-primary/90"
                    >
                        {isAutoProcessing ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                        </>
                        ) : (
                        <>
                            <Zap className="mr-2 h-4 w-4" />
                            Auto Process Remaining
                        </>
                        )}
                    </Button>
                 </div>
            )}
            <ResultsDisplay
              fileName={processedData.fileName}
              originalHeaders={processedData.originalHeaders}
              mappedHeaders={processedData.mappedHeaders}
              tableData={processedData.tableData}
            />
            <div className="text-center space-x-4">
               <Button 
                onClick={handleExportResults} 
                disabled={!hasExportableData || isExporting || isLoading || isAutoProcessing}
                size="lg"
                className="bg-primary hover:bg-primary/90"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  'Download Results'
                )}
              </Button>
              <Button 
                onClick={handleProcessAnotherFile} 
                variant="outline" 
                size="lg"
                disabled={isAutoProcessing || isLoading}
              >
                Process Another File
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
