import { groundTruth } from "../eval/groundTruth";

const DEMO_QUESTION_IDS = ["ipb017-rdson", "bsc010-current", "bsc027-new-design", "ipb044-application", "ipt007-class"];

export const demoQuestions = DEMO_QUESTION_IDS.map((id) => {
  const item = groundTruth.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Missing demo question ${id}`);
  }
  return {
    id: item.id,
    question: item.question,
    expectedPartNumber: item.expectedPartNumber
  };
});

