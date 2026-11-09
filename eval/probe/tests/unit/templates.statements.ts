// The five mandatory Author-steering statements, as key phrases (shared by the template and mapping tests).
export const STATEMENTS: Record<string, string[]> = {
  '1 relation direction': [
    `means #2 is #1's parent, not that #1 is #2's parent`,
    'Tags say what the second person (#2) is to the first person (#1)',
    'The first person is the one who feels it',
  ],
  '2 magnitude units': [
    'dollars for money events',
    'joss paper sheet counts for offerings',
    'intensity from 1 to 100 for social events',
  ],
  '3 official alive': ['alive means in office, not living'],
  '4 tick is a day': ['One tick is one day', 'Today is day {{tick}}.'],
  '5 actor order': ['loan: lender, then borrower', 'promise and promise_kept: promisor, then promisee'],
};
