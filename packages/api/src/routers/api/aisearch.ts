import { GoogleGenerativeAI } from '@google/generative-ai';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

const API_KEY = process.env.AI_SEARCH_API_KEY ?? '';
const genAI = new GoogleGenerativeAI(API_KEY);
const router = express.Router();

router.post(
  '/',
  validateRequest({
    body: z.object({
      query: z.string(),
      language: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { query, language } = req.body;
      console.log('lang=', language);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-thinking-exp-01-21',
      });

      const sqlPrompt = `You are working inside of a log observability tool that sends its data to a standard SQL Database.
      Convert natural language into an SQL where clause. Here is a list of functions you can use in addition
      to standard SQL operations.

      Example inputs and outputs:
      "All logs with a Body field that starts with HTTP 200 and doesn't contain ai" -> Body LIKE 'HTTP 200%' AND Body NOT LIKE '%ai%'
      "Messages with SeverityText equal to info or debug" -> SeverityText IN ('info', 'debug')
      "My Body field should equal Test" -> Body="Test"

      Now convert this query: ${query} and return it with only the string of SQL needed. Do not wrap it or format it.
      `;

      const systemPrompt = `You are working inside of a log observability tool. Convert natural language into lucene-like search queries.
      Rules:
      -Searches are not case sensitive
      -Searches match by whole word by default (ex. Error will match Error here but not Errors here). You can surround a word by wildcards to match partial words (ex. *Error* will match AnyError and AnyErrors)
      -Search terms are searched in any order (ex. Hello World will match logs that contain Hello World and World Hello)
      -You can exclude keywords by using NOT or - (ex. Error NOT Exception or Error -Exception)
      -You can use AND and OR to combine multiple keywords (ex. Error OR Exception)
      -Exact matches can be done via double quotes (ex. "Error tests not found")

      Grammar:
        * - conjunction operators (AND, OR, ||, &&, NOT, AND NOT, OR NOT)
        * - prefix operators (+, -)
        * - quoted values ("foo bar")
        * - named fields (foo:bar)
        * - range expressions (foo:[bar TO baz], foo:{bar TO baz})
        * - parentheses grouping ( (foo OR bar) AND baz )
        * - field groups ( foo:(bar OR baz) )
      
      Example inputs and outputs:
      "find errors and warnings but not debug messages" -> (error OR warning) NOT debug
      "show me failed payments in the body with status 400 or 500" -> body:(payment AND failed) AND (status:400 OR status:500)
      "get authentication errors from last hour" -> authentication AND error
      
      Now convert this query: ${query}`;

      const prompt = language === 'sql' ? sqlPrompt : systemPrompt;
      const result = await model.generateContent(prompt);
      const searchQuery = result.response.text().trim();

      if (!searchQuery) {
        throw new Error('No search query generated');
      }

      return res.status(200).json({ searchQuery });
    } catch (error) {
      console.error('Search generation error:', error);
      return res.status(500).json({ error: 'Failed to generate search query' });
    }
  },
);

export default router;
