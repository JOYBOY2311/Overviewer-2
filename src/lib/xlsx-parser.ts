import * as XLSX from 'xlsx';

export interface ParsedXLSXData {
  headers: string[];
  data: string[][];
}

export async function parseXLSX(file: File): Promise<ParsedXLSXData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result;
        if (!arrayBuffer) {
          throw new Error('Failed to read file buffer.');
        }
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Using header: 1 to get array of arrays, ensuring all cells are strings
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", rawNumbers: false });

        if (jsonData.length === 0) {
          resolve({ headers: [], data: [] });
          return;
        }

        const headers = jsonData[0].map(String); // First row as headers
        const data = jsonData.slice(1).map(row => row.map(String)); // Remaining rows as data

        resolve({ headers, data });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsArrayBuffer(file);
  });
}
