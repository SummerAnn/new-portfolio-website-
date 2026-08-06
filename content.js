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

export const notes = [
  {
    slug: "icml-accepted",
    category: "essay",
    kicker: "Research",
    date: "August 2026",
    readTime: "6 min",
    title: "The interaction tax paper got into ICML. Here is what I actually learned.",
    excerpt:
      "I started by asking whether multi-agent interaction helps or hurts. The answer turned out to depend entirely on what kind of information the agents exchange.",
    tags: ["ICML 2026", "Multi-agent systems", "Interaction tax"],
    body: [
      "The question that started this work was simple: does multi-agent LLM interaction help or hurt on optimization tasks? Some papers report gains from debate, critique loops, and mixture-of-agents synthesis. Others find that multi-agent systems add cost without improving quality under equal budgets, or that independent sampling already captures the benefit of multiple agents. Both sides had good evidence.",
      "We argued that this contradiction reflects a missing distinction, because not all multi-agent communication is equal. Different model families \u2014 Claude, GPT-4o, Gemini \u2014 find structurally different solutions. Each model family wins on different tasks, and no same-model team covers the whole benchmark. A diverse team never scores zero on any task. That coverage is valuable.",
      "The problem is what happens when agents exchange full solutions. When agents read each other\u2019s complete outputs, their proposals converge within a single round. Mean pairwise distance between solution representations falls from 0.315 before interaction to 0.229 after. Same-model teams can sometimes benefit because they refine similar proposals. But diverse-model teams lose, because the initially different solutions get pulled toward the same region. We call this loss the interaction tax.",
      "Chain, MAgICoRe, and Debate all produce positive same-model MIG but negative diverse-model MIG. MoA is the only configuration whose diverse MIG stays positive, because its proposers never see each other\u2019s outputs. The damage comes from the full-solution exchange step, not from synthesis or selection.",
      "One nuance we found is that critique can reverse the tax when the shared information points to a concrete, repairable fault. In Knapsack, a failed solution usually violates a clear capacity constraint, and the critic can propose a direct repair. Diverse Debate achieves 10/10 feasibility versus 2/10 for same-model. But in 3AP-Free, locating the violated arithmetic-progression triple is much harder, and diverse Debate drops to 0/10. The same act of sharing information helps or hurts depending on whether it gives the model a usable repair signal.",
      "The paper got accepted to the ICML 2026 workshop. What I took away is that multi-agent performance depends less on the number of agents than on the information they exchange and when it is exposed. Full candidate solutions create strong convergence pressure. Lower-bandwidth signals \u2014 scores, method descriptions, failure causes \u2014 may preserve independent exploration while still supporting coordination.",
    ],
  },
  {
    slug: "interaction-tax",
    category: "essay",
    kicker: "Research",
    date: "July 2026",
    readTime: "5 min",
    title: "Why I keep returning to the interaction tax in multi-agent systems.",
    excerpt:
      "The hard part is not getting more agents to talk. It is making sure communication does not erase the diversity you needed from the team in the first place.",
    tags: ["Multi-agent systems", "LLM evaluation", "Research"],
    body: [
      "The interaction tax is what happens when agents exchange full solutions and their proposals converge, erasing the diversity that motivated using multiple models in the first place. Different model families search different parts of the solution space, but that advantage disappears the moment they read each other\u2019s complete outputs.",
      "A lot of multi-agent demos assume that more communication is automatically better. In our experiments, full-solution interaction causes solutions to converge within a single round. The damage is immediate, not gradual. On some tasks, diverse Debate achieves a strong intermediate score but regresses once agents read each other\u2019s full solutions.",
      "That is why I care about matched-budget evaluation and metrics like marginal epistemic gain. The question is not just whether a team can collaborate. It is whether the collaboration produces better outcomes than the same models working independently under the same resource budget. MoA works because proposers never see each other\u2019s outputs. The information channel matters more than the number of agents.",
    ],
  },
  {
    slug: "why-ai4science-matters",
    category: "essay",
    kicker: "Research",
    date: "July 2026",
    readTime: "7 min",
    title: "Why AI for science is not just another application area.",
    excerpt:
      "Scientific discovery is where the stakes for getting AI right are highest and the cost of getting it wrong is most invisible.",
    tags: ["AI4Science", "AI safety", "Scientific AI"],
    body: [
      "There is a version of AI for science that is mostly about automation, about running more experiments faster. That version is fine but it is not what keeps me up at night. What keeps me up is the version where AI systems start shaping which hypotheses get explored and which get abandoned, and nobody notices the selection pressure because the outputs still look like science.",
      "Yoshua Bengio put it directly: \u2018We need to treat AI safety as seriously as we treat climate change. The risks are not hypothetical.\u2019 I think about that framing a lot, especially for scientific AI, because the failure mode is not a dramatic catastrophe. It is a slow drift where AI-assisted research produces confident-looking results built on hidden fragility.",
      "Stuart Russell\u2019s point is adjacent but sharper for this domain: \u2018The problem is not that machines will become hostile, but that they might be too good at achieving the wrong objective.\u2019 In science, the wrong objective looks like optimizing for publishable metrics instead of durable understanding. Multi-agent systems make this worse if the agents learn to coordinate around what scores well rather than what is true.",
      "That is one reason I moved from computational medicine into multi-agent scientific AI. In biomedical ML, I saw firsthand how a pipeline that looks clean can hide compounding errors across preprocessing, cohort construction, and evaluation. The model is the glamorous part. The part that determines whether anyone can trust it later is everything around the model.",
      "AI for science matters because science is the domain where we most need AI to be honest, auditable, and resistant to its own biases. If we build AI systems that produce results no human can verify, we have not automated science. We have automated the appearance of science. That distinction is the entire game.",
      "The reason I care about multi-agent safety specifically is that it sits at the intersection of these problems. When agents collaborate on scientific work, every coordination step is a place where error can compound or diversity can collapse. Getting the interaction right is not an engineering detail. It is the research question.",
    ],
  },
  {
    slug: "persistent-agent-runtime",
    category: "process",
    kicker: "Systems",
    date: "June 2026",
    readTime: "5 min",
    title: "A scientific agent is only as good as its runtime.",
    excerpt:
      "If the runtime cannot survive long horizons, memory, retries, and provenance, then the agent is only performing intelligence in short bursts.",
    tags: ["Flamebird", "Runtimes", "Infrastructure"],
    body: [
      "I care a lot less about a polished single interaction than I do about what happens when a system needs to keep state across hours or days. That is where the runtime starts to matter more than the prompt.",
      "For scientific workflows, you need durable queues, resumable execution, structured memory, and enough provenance to understand what happened after the fact. Otherwise you cannot trust the output, even when it looks coherent on the surface.",
      "That is the motivation behind Flamebird. I wanted the system beneath the agents to be honest about long-horizon work instead of pretending every task lives inside one clean context window.",
    ],
  },
  {
    slug: "compute-is-part-of-the-experiment",
    category: "field",
    kicker: "Evaluation",
    date: "May 2026",
    readTime: "4 min",
    title: "Compute budgets are part of the experiment, not an implementation detail.",
    excerpt:
      "When an evaluation ignores inference cost, token budget, and coordination overhead, it quietly turns those costs into free magic.",
    tags: ["MEG", "Benchmarking", "Scientific AI"],
    body: [
      "I do not think multi-agent evaluation is meaningful if the baseline and the collaborative system are allowed to spend wildly different amounts of compute without anyone naming that difference explicitly.",
      "A stronger result is not actually stronger if it only exists because the system was allowed to burn extra search, extra messaging, and extra future work with no accounting. Those are real resources.",
      "That is why I am interested in compute-matched protocols and ideas like marginal epistemic gain. The metric should expose how much knowledge the collaboration really bought, not just whether it looked impressive in aggregate.",
    ],
  },
  {
    slug: "from-medicine-to-agents",
    category: "field",
    kicker: "Path",
    date: "April 2026",
    readTime: "5 min",
    title: "From computational medicine to multi-agent systems: the thread that connects them.",
    excerpt:
      "The same instinct that made me care about reproducibility in biomedical pipelines is the one that now makes me care about interaction quality between agents.",
    tags: ["Biomedical ML", "Multi-agent systems", "Research path"],
    body: [
      "Before I was studying agent interactions, I was building preprocessing pipelines for ECG data and immune receptor sequences. The work was quieter but the lesson was the same: if you do not control the upstream process, nothing downstream is trustworthy.",
      "In biomedical ML, a lot of downstream confusion begins long before the model. It starts with inconsistent preprocessing, ambiguous cohort construction, and experiments that are hard to rerun cleanly. I spent a lot of time making those steps boring in the good sense: versioned, auditable, and stable.",
      "That same instinct carried over directly. In multi-agent systems, the upstream process is the interaction itself. If agents converge too fast, echo each other, or optimize for fluency over substance, the scientific output is compromised in the same way a bad preprocessing step compromises a clinical model.",
      "The connection is not metaphorical. It is the same failure mode: invisible compounding error in a system that produces confident-looking output. The difference is that in agent systems, the error compounds through communication rather than through data transformations. But the fix is the same: instrument everything, control for confounds, and never trust the surface.",
    ],
  },
  {
    slug: "boring-biomedical-pipelines",
    category: "process",
    kicker: "Biomedical ML",
    date: "March 2026",
    readTime: "5 min",
    title: "Biomedical ML gets better when the pipeline is boring and reproducible.",
    excerpt:
      "The glamorous part is usually the model. The part that determines whether anyone can trust it later is the pipeline around the data.",
    tags: ["Biomedical ML", "Data pipelines", "Reproducibility"],
    body: [
      "In biomedical machine learning, a lot of downstream confusion begins long before the model. It starts with inconsistent preprocessing, ambiguous cohort construction, and experiments that are hard to rerun cleanly.",
      "I care about making those steps boring in the good sense: versioned, auditable, and stable enough that a change in outcome can be traced back to a real change in the workflow.",
      "That is why data processing, quality control, and reproducible infrastructure matter so much in the immune receptor and ECG work. If the pipeline is not dependable, interpretability downstream becomes much harder to take seriously.",
    ],
  },
];

export const researchHighlight = {
  venue: "ICML 2026 Workshop",
  title: "The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams",
  description:
    "Full-solution exchange between diverse LLM agents (Claude, GPT-4o, Gemini) collapses proposal diversity within a single round. MoA \u2014 where proposers never see each other\u2019s outputs \u2014 is the only configuration whose diverse-model MIG stays positive.",
};
