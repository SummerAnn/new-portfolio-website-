export const research = [
  {
    title: "The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams",
    year: "2025–2026",
    venue: "ICML 2026 Workshop",
    role: "First Author",
    blurb:
      "Does multi-agent LLM interaction help or hurt? We show that full-solution exchange collapses the diversity that makes using multiple model families worthwhile.",
    stack: ["Multi-agent systems", "LLM evaluation", "Optimization"],
    link: "https://openreview.net/profile?id=~Summer_Eunhyung_Ann1",
    details: [
      "Tested 10 configurations across 11 verifier-scored optimization tasks using Claude Sonnet 4, GPT-4o, and Gemini 2.5 Flash under matched budgets",
      "Showed that full-solution interaction causes proposals to converge within a single round — Chain, MAgICoRe, and Debate all produce negative diverse-model MIG",
      "MoA (independent proposers, then synthesis) is the only configuration whose diverse MIG stays positive, because proposers never see each other's outputs",
      "Critique helps only when the fault is easy to locate: Knapsack (clear constraint violation) vs 3AP-Free (hard to find arithmetic-progression triple)",
    ],
  },
  {
    title: "Agent4Science + Flamebird",
    year: "2026–Present",
    venue: "Scientific AI Infrastructure",
    role: "Creator",
    blurb:
      "Multi-agent platform for scientific collaboration backed by a persistent runtime for long-horizon workflows, structured coordination, and execution-grounded validation.",
    stack: ["Multi-agent systems", "Runtime infrastructure", "LLM evaluation"],
    link: "https://agent4science.org",
    details: [
      "Specialized agents for retrieval, hypothesis generation, experiment design, and analysis",
      "Persistent runtime (Flamebird) with spawn, checkpoint, resume, provenance, and reproducibility",
      "Execution-grounded auditing and benchmarking for realistic scientific workflows",
    ],
  },
  {
    title: "ProtoECGNet / EchoNext",
    year: "2025",
    venue: "Biomedical ML",
    role: "Researcher",
    blurb:
      "Adaptation of ProtoECGNet for the EchoNext cardiac dataset — prototype-based structural heart disease classification with built-in interpretability, embedding analysis, and prototype drift monitoring.",
    stack: ["ECG analysis", "Prototype learning", "Interpretable ML"],
    link: "https://github.com/SummerAnn?tab=repositories",
    details: [
      "Adapted prototype-based neural networks for SHD (structural heart disease) classification from ECG foundation model embeddings",
      "Built experiment pipelines for embedding correlations, prototype drift tracking, and multi-task classification across cardiac conditions",
      "Developed realness-checking and audit tooling to validate experimental artifacts and reproducibility",
    ],
  },
  {
    title: "STR Genomics & SEI Framework",
    year: "2022–2024",
    venue: "University of Michigan — Boyle Lab",
    role: "Undergraduate Research Assistant",
    blurb:
      "Applied the SEI framework to short tandem repeat analysis for disease classification, combining ML with regulatory activity prediction across 21,907 chromatin profiles.",
    stack: ["Genomics", "STR analysis", "Deep learning", "SEI"],
    link: "https://boylelab.org/people/Summer_Ann",
    details: [
      "Analyzed STR loci using SEI — a framework mapping DNA sequences to regulatory activities across 40 sequence classes and 21,907 chromatin profiles",
      "Applied dimensionality reduction (PCA, t-SNE, UMAP) and clustering (K-Means, Louvain) for STR allele classification and population genetics",
      "Built reproducible pipelines in Python with PyTorch, Selene, and Bedtools for genomic data processing and feature extraction",
    ],
  },
  {
    title: "Immune TCR Dataset Curation",
    year: "2024–2025",
    venue: "CZ Biohub Chicago",
    role: "Contributor",
    blurb:
      "Curation of paired TCR alpha/beta sequence datasets from public sources for protein language model training — building structured immunology data infrastructure.",
    stack: ["Immunology", "TCR sequencing", "Data curation"],
    link: "https://github.com/SummerAnn?tab=repositories",
    details: [
      "Contributed to curation of paired TCR alpha and beta sequences with standardized metadata across Parse Biosciences, VDJserver, and OTS sources",
      "Supported IgBLAST-based annotation pipelines and sequence stitching workflows for T cell receptor characterization",
    ],
  },
  {
    title: "Repeat Expansion Disorders",
    year: "2022–2023",
    venue: "University of Michigan — Todd Lab",
    role: "Research Assistant",
    blurb:
      "Research on repeat expansion disorders and neurodegenerative disease mechanisms across mouse, Drosophila, and stem cell model systems.",
    stack: ["Neuroscience", "Repeat expansion", "Disease modeling"],
    link: "https://sites.google.com/site/toddlabmichigan/todd-lab",
    details: [
      "Contributed to research on Fragile X-associated disorders, cerebellar ataxia, and repeat-associated non-ATG (RAN) translation",
      "Worked across mouse, Drosophila, and stem cell model systems to study molecular mechanisms of neurodegeneration",
    ],
  },
  {
    title: "DIY Eye Tracker & Attention Games",
    year: "Summer 2023",
    venue: "Backyard Brains Fellowship",
    role: "Research Fellow",
    blurb:
      "Built an accessible DIY eye tracker to study human gaze patterns on facial features and created three open-source web apps for public engagement with attention and perception research.",
    stack: ["Eye tracking", "HCI", "Open-source neuroscience"],
    link: "https://blog.backyardbrains.com/2023/07/diy-eye-tracker-project/",
    details: [
      "Designed a DIY eye tracker investigating whether humans spend disproportionate time looking at eyes versus other facial features",
      "Created Reaction Time Game, Webfacegazer (webcam-based gaze tracking via open-source HCI library), and Eyebeam Measurement Game",
    ],
  },
  {
    title: "Mishina Lab Research",
    year: "2021",
    venue: "University of Michigan — Mishina Lab",
    role: "Research Assistant",
    blurb:
      "Research in the Mishina Lab at the University of Michigan.",
    stack: ["Biomedical research"],
    link: "./assets/Summer Ann Poster Final .pdf",
    details: [],
  },
];

export const startups = [
  {
    title: "Deva",
    type: "AI Security Platform \u00b7 20K+ users",
    blurb:
      "AI-native secure coding and compliance platform through DevSecCode. Layered engine spanning rules, AST analysis, and dependency-aware enrichment.",
    stack: ["AppSec", "LLM systems", "Compliance"],
  },
  {
    title: "NeuroMuse",
    type: "AI Music Generation \u00b7 LLM/Data Engineer",
    blurb:
      "Natural language-to-music generation stack with instruction-tuned LLMs, modular prompting for style/tempo/instrumentation, and retrieval-augmented creator-specific style transfer.",
    stack: ["LLMs", "Music generation", "RAG"],
  },
  {
    title: "ConcordX",
    type: "Trading Systems \u00b7 Co-CTO",
    blurb:
      "Concord Systems Corp — Fireblocks MPC integration, trade execution with predictive models reducing frontrunning by 18%, and real-time transaction coordination at 200+ TPS.",
    stack: ["Trading systems", "Web3", "ML"],
  },
  {
    title: "Products & Apps",
    type: "Consumer + Creator Software",
    blurb:
      "Yammoing, BreatheMindful, CreatorFlow AI, and other iOS and local-first products.",
    stack: ["SwiftUI", "Next.js"],
  },
];

export const apps = [
  {
    title: "BreatheMindful",
    desc: "Wellness companion",
    link: "https://apps.apple.com/us/app/breathemindful/id6757343368",
    linkLabel: "App Store",
  },
  {
    title: "Yammoing",
    desc: "AI nutrition companion",
    link: "https://apps.apple.com/us/app/yammoing/id6757343455",
    linkLabel: "App Store",
  },
  {
    title: "Secret Student Society",
    desc: "University community hub",
    link: "https://secretstudentsociety.com",
    linkLabel: "Visit Site",
  },
  {
    title: "Deva",
    desc: "Security-first IDE",
    link: "https://devseccode.com",
    linkLabel: "Visit devseccode.com",
  },
  {
    title: "Angel With You",
    desc: "Personal safety companion",
    link: "https://summitwanderlust.com/",
    linkLabel: "App Store",
  },
  {
    title: "Lovocado",
    desc: "The couple app for connection",
    link: "https://apps.apple.com/us/app/lovocado/id6757644902",
    linkLabel: "App Store",
  },
  {
    title: "motive.",
    desc: "Daily motivation companion",
    link: "https://apps.apple.com/us/app/motive/id6761436873",
    linkLabel: "App Store",
  },
];

export const experience = [
  {
    title: "AWS AI/ML",
    role: "Solutions Architect Intern",
    blurb: "Built ZON, an LLM-powered scheduling assistant on AWS Bedrock with multi-step calendar reasoning across timezones.",
  },
];

export const notes = [];

export const researchHighlight = {
  venue: "ICML 2026 Workshop",
  title: "The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams",
  description:
    "Full-solution exchange between diverse LLM agents (Claude, GPT-4o, Gemini) collapses proposal diversity within a single round. MoA \u2014 where proposers never see each other\u2019s outputs \u2014 is the only configuration whose diverse-model MIG stays positive.",
};
