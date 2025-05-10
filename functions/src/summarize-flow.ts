
'use server';
/**
 * @fileOverview Summarizes company website content using an LLM, including independence and information sufficiency.
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
});
export type SummarizeContentInput = z.infer<typeof SummarizeContentInputSchema>;

export const UNUSABLE_CONTENT_RESPONSE = "Due to a website error, the company’s business function could not be determined.";

const SummarizeContentOutputSchema = z.object({
  summary: z.string().describe(`The concise 2-3 sentence business overview. If the content is unusable, this will be '${UNUSABLE_CONTENT_RESPONSE}'.`),
  independenceCriteria: z.string().describe('Set to "Yes" if the company appears to be owned by a government body, nonprofit organization, or parent company. Otherwise, an empty string.'),
  insufficientInformation: z.string().describe('Set to "Yes" if the company’s function could not be determined from the content. Otherwise, an empty string.'),
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

Also, determine the following based *only* on the provided text:
- Independence Criteria: If the text suggests the company is owned by a government body, a nonprofit organization, or explicitly states it is a subsidiary of another parent company, set 'independenceCriteria' to "Yes". Otherwise, set 'independenceCriteria' to "".
- Insufficient Information: If the provided text is insufficient to determine the company's function (e.g., it's an error page, parked domain, mostly job listings, or too generic), set 'insufficientInformation' to "Yes" and for the 'summary' field, respond with: '${UNUSABLE_CONTENT_RESPONSE}'. Otherwise, set 'insufficientInformation' to "".

Avoid speculation. Base your answers strictly on the provided text.

Company Webpage Text:
{{{content}}}
`,
 config: {
    // Default safety settings are usually fine, but can be adjusted if needed
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
    // Ensure that if summary is UNUSABLE_CONTENT_RESPONSE, insufficientInformation is "Yes".
    // The prompt guides the LLM, this is a fallback.
    if (output.summary === UNUSABLE_CONTENT_RESPONSE && output.insufficientInformation !== "Yes") {
      output.insufficientInformation = "Yes";
    }
    return output;
  }
);

// Constant for checking the specific error message
export { UNUSABLE_CONTENT_RESPONSE };
