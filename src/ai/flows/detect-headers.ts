'use server';

/**
 * @fileOverview Detects column headers for 'Company Name', 'Country', and 'Website' in an uploaded XLSX file.
 *
 * - detectHeaders - A function that handles the header detection process.
 * - DetectHeadersInput - The input type for the detectHeaders function.
 * - DetectHeadersOutput - The return type for the detectHeaders function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DetectHeadersInputSchema = z.object({
  headers: z.array(z.string()).describe('An array of column headers from the XLSX file.'),
});
export type DetectHeadersInput = z.infer<typeof DetectHeadersInputSchema>;

const DetectHeadersOutputSchema = z.object({
  companyName: z.string().describe('The detected column header for Company Name.'),
  country: z.string().describe('The detected column header for Country.'),
  website: z.string().describe('The detected column header for Website.'),
});
export type DetectHeadersOutput = z.infer<typeof DetectHeadersOutputSchema>;

export async function detectHeaders(input: DetectHeadersInput): Promise<DetectHeadersOutput> {
  return detectHeadersFlow(input);
}

const prompt = ai.definePrompt({
  name: 'detectHeadersPrompt',
  input: {schema: DetectHeadersInputSchema},
  output: {schema: DetectHeadersOutputSchema},
  prompt: `You are an expert in data analysis.  Given a list of column headers from a spreadsheet, you will determine which header represents 'Company Name', 'Country', and 'Website'.

Here are the available headers:
{{#each headers}}{{{this}}}{{#unless @last}}, {{/unless}}{{/each}}

Return a JSON object with the keys 'companyName', 'country', and 'website', and the corresponding header values.
If a header is not found, return an empty string.`,
});

const detectHeadersFlow = ai.defineFlow(
  {
    name: 'detectHeadersFlow',
    inputSchema: DetectHeadersInputSchema,
    outputSchema: DetectHeadersOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
