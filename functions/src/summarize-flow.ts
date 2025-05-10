
'use server';
/**
 * @fileOverview Summarizes company website content using an LLM.
 *
 * - summarizeContent - A function that handles the content summarization process.
 * - SummarizeContentInput - The input type for the summarizeContent function.
 * - SummarizeContentOutput - The return type for the summarizeContent function.
 */

import { genkit, Ai } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'genkit/zod'; // Use genkit's zod export

// Initialize Genkit and Google AI plugin
// Ensure GOOGLE_API_KEY is set in the environment for this to work.
export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-2.0-flash', // Consistent with the main app's Genkit setup
  enableTracing: process.env.NODE_ENV !== 'production',
});

const SummarizeContentInputSchema = z.object({
  content: z.string().min(1).describe('The raw text content scraped from the company website (approx. 300-1000 words).'),
  // Optional: originalUrl: z.string().url().optional().describe('The original URL from which the content was scraped.'),
});
export type SummarizeContentInput = z.infer<typeof SummarizeContentInputSchema>;

const UNUSABLE_CONTENT_RESPONSE = "Due to a website error, the company’s business function could not be determined.";

const SummarizeContentOutputSchema = z.object({
  summary: z.string().describe(`The concise 2-3 sentence business overview. If the content is unusable, this will be '${UNUSABLE_CONTENT_RESPONSE}'.`),
});
export type SummarizeContentOutput = z.infer<typeof SummarizeContentOutputSchema>;

export async function summarizeContent(input: SummarizeContentInput): Promise<SummarizeContentOutput> {
  return summarizeContentFlow(input);
}

const summarizePrompt = ai.definePrompt({
  name: 'summarizeCompanyContentPrompt',
  input: { schema: SummarizeContentInputSchema },
  output: { schema: SummarizeContentOutputSchema },
  prompt: `You are a Transfer Pricing analyst. Based on the following company webpage text, write a concise 2-3 sentence business overview. Use a formal and analytical tone. Include:
- The company’s main business activity
- Key products or services
- The sector or industry

Avoid speculation. If the content is mostly unrelated or unusable, respond with:
'${UNUSABLE_CONTENT_RESPONSE}'

Company Webpage Text:
{{{content}}}
`,
 config: { // Default safety settings are usually fine, but can be adjusted if needed
    // safetySettings: [ 
    //   { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    // ],
  }
});

const summarizeContentFlow = ai.defineFlow(
  {
    name: 'summarizeContentFlow',
    inputSchema: SummarizeContentInputSchema,
    outputSchema: SummarizeContentOutputSchema,
  },
  async (input) => {
    const { output } = await summarizePrompt(input);
    if (!output) {
        // This case should ideally be handled by the LLM returning the specific error string as per the prompt.
        // If output is null/undefined, it's an unexpected Genkit issue or misconfiguration.
        throw new Error('LLM did not return an output.');
    }
    return output;
  }
);

// Constant for checking the specific error message
export { UNUSABLE_CONTENT_RESPONSE };
