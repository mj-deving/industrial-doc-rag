export type EvalCase = {
  id: string;
  question: string;
  expectedPartNumber: string;
  expectedTerms: string[];
};

export const groundTruth: EvalCase[] = [
  {
    id: "ipb017-voltage",
    question: "What drain-source voltage is IPB017N10N5 rated for?",
    expectedPartNumber: "IPB017N10N5",
    expectedTerms: ["100", "V"]
  },
  {
    id: "ipb017-rdson",
    question: "What is the maximum RDS(on) for IPB017N10N5?",
    expectedPartNumber: "IPB017N10N5",
    expectedTerms: ["1.7", "mOhm"]
  },
  {
    id: "ipb017-package",
    question: "Which package does IPB017N10N5 use?",
    expectedPartNumber: "IPB017N10N5",
    expectedTerms: ["PG-TO263-7"]
  },
  {
    id: "bsc010-rdson",
    question: "What RDS(on) at 10 V is listed for BSC010N04LS?",
    expectedPartNumber: "BSC010N04LS",
    expectedTerms: ["1", "mOhm"]
  },
  {
    id: "bsc010-current",
    question: "What maximum drain current is listed for BSC010N04LS at 25 C?",
    expectedPartNumber: "BSC010N04LS",
    expectedTerms: ["281", "A"]
  },
  {
    id: "bsc027-new-design",
    question: "Is BSC027N04LS G recommended for new designs?",
    expectedPartNumber: "BSC027N04LS G",
    expectedTerms: ["not for new design"]
  },
  {
    id: "bsc027-rdson",
    question: "What is the BSC027N04LS G maximum RDS(on)?",
    expectedPartNumber: "BSC027N04LS G",
    expectedTerms: ["2.7", "mOhm"]
  },
  {
    id: "ipb044-voltage",
    question: "What drain-source voltage class is IPB044N15N5?",
    expectedPartNumber: "IPB044N15N5",
    expectedTerms: ["150", "V"]
  },
  {
    id: "ipb044-application",
    question: "Which low voltage drive applications are named for IPB044N15N5?",
    expectedPartNumber: "IPB044N15N5",
    expectedTerms: ["forklift", "e-scooter"]
  },
  {
    id: "ipt007-class",
    question: "Which voltage class is IPT007N06N in this corpus?",
    expectedPartNumber: "IPT007N06N",
    expectedTerms: ["60", "V"]
  }
];
