'use client';

import type { DetectHeadersOutput } from '@/ai/flows/detect-headers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TableDataRow {
  id: string;
  values: (string | undefined)[];
  hasError: boolean;
  processingStatus: 'Fetched' | 'To Process';
}

interface ResultsDisplayProps {
  fileName: string;
  originalHeaders: string[];
  mappedHeaders: DetectHeadersOutput;
  tableData: TableDataRow[];
}

export function ResultsDisplay({ fileName, originalHeaders, mappedHeaders, tableData }: ResultsDisplayProps) {
  const renderMappedHeader = (headerName: string, mappedValue: string | undefined) => {
    return (
      <li className="flex justify-between items-center">
        <span>{headerName}:</span>
        {mappedValue && mappedValue.trim() !== '' ? (
          <Badge variant="secondary" className="font-mono">{mappedValue}</Badge>
        ) : (
          <Badge variant="outline">Not Detected</Badge>
        )}
      </li>
    );
  };

  return (
    <Card className="shadow-lg w-full animate-fadeIn">
      <CardHeader>
        <CardTitle className="text-2xl">Processed Data: {fileName}</CardTitle>
        <CardDescription>Review the detected headers, data preview, and processing status below.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold mb-2 text-primary">Detected Headers</h3>
          <ul className="space-y-1 text-sm">
            {renderMappedHeader('Company Name', mappedHeaders.companyName)}
            {renderMappedHeader('Country', mappedHeaders.country)}
            {renderMappedHeader('Website', mappedHeaders.website)}
          </ul>
        </div>

        <h3 className="text-lg font-semibold mb-3 text-primary">Data Preview</h3>
        {tableData.length === 0 ? (
          <p className="text-muted-foreground">No data to display.</p>
        ) : (
          <ScrollArea className="h-[400px] w-full border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
                <TableRow>
                  {originalHeaders.map((header, index) => (
                    <TableHead key={`${header}-${index}`} className="font-semibold whitespace-nowrap">
                      {header}
                    </TableHead>
                  ))}
                  <TableHead className="font-semibold whitespace-nowrap">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "transition-colors duration-300",
                      row.hasError && "bg-destructive/10 hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
                      row.processingStatus === 'Fetched' && "bg-primary/10 hover:bg-primary/20"
                    )}
                  >
                    {row.values.map((cell, cellIndex) => (
                      <TableCell key={`${row.id}-cell-${cellIndex}`} className="whitespace-nowrap">
                        {cell === undefined || cell === null ? '' : cell}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={row.processingStatus === 'Fetched' ? 'default' : 'secondary'}>
                        {row.processingStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
        <style jsx global>{`
          .animate-fadeIn {
            animation: fadeIn 0.5s ease-in-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </CardContent>
    </Card>
  );
}
