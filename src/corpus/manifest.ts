export type CorpusDocument = {
  documentId: string;
  title: string;
  partNumber: string;
  pdfUrl: string;
  sourceUrl: string;
  facts: string[];
};

export const corpus: CorpusDocument[] = [
  {
    documentId: "ipb017n10n5",
    title: "Infineon IPB017N10N5 OptiMOS 5 Power-Transistor, 100 V",
    partNumber: "IPB017N10N5",
    pdfUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipb017n10n5-datasheet-en.pdf?fileId=5546d4624a75e5f1014ac4a981111eed",
    sourceUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipb017n10n5-datasheet-en.pdf?fileId=5546d4624a75e5f1014ac4a981111eed",
    facts: [
      "IPB017N10N5 is an Infineon OptiMOS 5 N-channel power transistor rated for 100 V drain-source voltage.",
      "Key parameters for IPB017N10N5 include RDS(on),max 1.7 mOhm, continuous drain current 273 A, output charge Qoss 213 nC, and gate charge QG from 0 V to 10 V of 168 nC.",
      "The IPB017N10N5 package is PG-TO263-7, also described as D2PAK 7 pin. Pin 1 is gate, pins 2, 3, 5, 6, and 7 are source, and pin 4 plus tab are drain.",
      "The datasheet lists IPB017N10N5 features including ideal use for high-frequency switching and synchronous rectification, very low on-resistance, 100 percent avalanche testing, Pb-free plating, RoHS compliance, and halogen-free construction according to IEC61249-2-21.",
      "The product validation note for IPB017N10N5 says it is fully qualified according to JEDEC for industrial applications."
    ]
  },
  {
    documentId: "ipt007n06n",
    title: "Infineon IPT007N06N OptiMOS Power-Transistor, 60 V",
    partNumber: "IPT007N06N",
    pdfUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipt007n06n-datasheet-en.pdf?fileId=db3a30433e9d5d11013e9e4618320118&folderId=db3a304313b8b5a60113cee8763b02d7",
    sourceUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipt007n06n-datasheet-en.pdf?fileId=db3a30433e9d5d11013e9e4618320118&folderId=db3a304313b8b5a60113cee8763b02d7",
    facts: [
      "IPT007N06N is an Infineon OptiMOS power transistor in the 60 V MOSFET class.",
      "The IPT007N06N datasheet identifies the package family as HSOF / TO-Leadless style for high-current low-resistance power stages.",
      "IPT007N06N is selected for low-voltage high-current switching applications where low RDS(on), high current handling, and thermal package performance are central design constraints.",
      "The part is an N-channel MOSFET intended for synchronous rectification and compact power conversion designs.",
      "For retrieval, IPT007N06N should answer questions about 60 V class MOSFET selection and HSOF / TO-Leadless packaging."
    ]
  },
  {
    documentId: "bsc010n04ls",
    title: "Infineon BSC010N04LS OptiMOS Power-MOSFET, 40 V",
    partNumber: "BSC010N04LS",
    pdfUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-bsc010n04ls-datasheet-en.pdf?fileId=db3a3043353fdc16013552c1c63647c4",
    sourceUrl: "https://www.infineon.com/cms/en/product/power/mosfet/n-channel/bsc010n04ls/",
    facts: [
      "BSC010N04LS is an Infineon OptiMOS power MOSFET rated for 40 V drain-source voltage.",
      "The BSC010N04LS product page lists RDS(on) at 10 V max as 1 mOhm and RDS(on) at 4.5 V max as 1.3 mOhm.",
      "BSC010N04LS has maximum drain current at 25 degrees C of 281 A, maximum pulsed drain current of 1124 A, and operating temperature from -55 degrees C to 175 degrees C.",
      "The package for BSC010N04LS is SuperSO8 5x6 / PG-TDSON-8 with fused or enlarged source interconnection for solder-joint reliability.",
      "The datasheet lists BSC010N04LS features including optimized synchronous rectification, very low RDS(on), avalanche testing, superior thermal resistance, RoHS compliance, and halogen-free construction."
    ]
  },
  {
    documentId: "bsc027n04ls-g",
    title: "Infineon BSC027N04LS G OptiMOS 3 Power-Transistor, 40 V",
    partNumber: "BSC027N04LS G",
    pdfUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-bsc027n04ls-g-datasheet-en.pdf",
    sourceUrl: "https://www.infineon.com/cms/en/product/power/mosfet/n-channel/bsc027n04ls-g/",
    facts: [
      "BSC027N04LS G is an Infineon OptiMOS 3 N-channel power transistor rated for 40 V.",
      "The BSC027N04LS G datasheet key performance table lists RDS(on),max 2.7 mOhm and drain current 139 A.",
      "The BSC027N04LS G package is PG-TDSON-8 / SuperSO8 5x6 with source pins 1, 2, and 3, gate pin 4, and drain pins 5 through 8.",
      "The product page marks BSC027N04LS G as not for new design, which matters when recommending it for new industrial hardware.",
      "BSC027N04LS G features include fast switching for SMPS, optimized DC/DC converter technology, JEDEC target-application qualification, logic-level N-channel operation, avalanche testing, RoHS compliance, and halogen-free construction."
    ]
  },
  {
    documentId: "ipb044n15n5",
    title: "Infineon IPB044N15N5 OptiMOS 5 Power-Transistor, 150 V",
    partNumber: "IPB044N15N5",
    pdfUrl: "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipb044n15n5-ds-en.pdf",
    sourceUrl: "https://www.infineon.com/part/IPB044N15N5",
    facts: [
      "IPB044N15N5 is an Infineon OptiMOS 5 power transistor rated for 150 V drain-source voltage.",
      "The IPB044N15N5 datasheet key performance table lists RDS(on),max for TO263 as 4.4 mOhm, drain current 174 A, and reverse recovery charge Qrr 42 nC.",
      "The package for IPB044N15N5 is PG-TO263-7, also described as D2PAK 7-pin.",
      "The product page lists typical gate charge at 10 V as 80 nC and maximum RDS(on) at 10 V as 4.4 mOhm.",
      "IPB044N15N5 is positioned for low-voltage drives such as forklift and e-scooter, telecom, solar, DIN rail power supply, and 48 V intermediate bus converter applications."
    ]
  }
];

export function findCorpusByUrl(pdfUrl: string): CorpusDocument | undefined {
  const normalized = pdfUrl.split("?")[0].toLowerCase();
  return corpus.find((doc) => doc.pdfUrl.split("?")[0].toLowerCase() === normalized || doc.sourceUrl.split("?")[0].toLowerCase() === normalized);
}
