// The demo questions the console offers as chips.
//
// Four parts are in the index. The fifth is not: BUK9V13-40H was held out on
// purpose and sits one letter away from BUK9K13-40H, which IS indexed and which
// dense retrieval returns first, with a complete and entirely wrong table. It is
// here so that a visitor can trigger the refusal instead of taking it on trust.
//
// The conditions are part of the RDS(on) question because RDS(on) is not one
// number. It varies by more than 2x with junction temperature and about 1.6x with
// gate drive, so "the RDS(on) of this part" is ill-posed, and a system that answers
// it confidently is guessing at which row of the table you meant.

export type ConsoleQuestion = {
  question: string;
  part: string;
  heldOut?: boolean;
};

export const consoleQuestions: ConsoleQuestion[] = [
  {
    question: "What is the maximum RDS(on) of the PSMN011-100YSF at VGS = 10 V; ID = 20 A; Tj = 25 °C?",
    part: "PSMN011-100YSF"
  },
  {
    question: "What is the drain-source voltage rating (VDS) of the PMV20XNE?",
    part: "PMV20XNE"
  },
  {
    question: "Which package is the BUK768R1-40E supplied in?",
    part: "BUK768R1-40E"
  },
  {
    question: "What continuous drain current is the PMV48XPA2 rated for?",
    part: "PMV48XPA2"
  },
  {
    question: "What is the maximum RDS(on) of the BUK9V13-40H?",
    part: "BUK9V13-40H",
    heldOut: true
  }
];
