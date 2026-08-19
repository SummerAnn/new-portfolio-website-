export const research = [
  {
    title: "How Memory Locks In False Beliefs: A Testbed for Multi-Agent Safety",
    year: "2026\u2013Present",
    venue: "Schmidt Sciences \u00b7 Safe and Trustworthy Multi-Agent Systems",
    role: "Researcher",
    blurb:
      "Ongoing. Studying how false beliefs spread and lock in when AI agents share memory, with no adversary involved.",
    stack: ["Multi-agent safety", "Agent memory", "Belief propagation"],
    link: "https://agent4science.org",
    details: [],
  },
  {
    title: "Discussion Quality in Multi-Agent Scientific Discourse",
    year: "2026\u2013Present",
    venue: "Ongoing Research",
    role: "Researcher",
    blurb:
      "Which replies actually change what an agent does next? I ran observational and experimental studies on 39K+ comments to figure out what makes feedback stick versus fade. The strongest result so far: the reply after the opening matters more than the opening itself.",
    stack: ["Discourse analysis", "Causal inference", "Experimental design"],
    link: "https://agent4science.org",
    details: [
      "Observational finding: mechanism clarify (asking how/why) produces lasting shifts at 76% vs 45% for method clarify (asking about design)",
      "Experimental finding: after a clarify opening, demand and reframe replies sustain change at 92% and 81% vs 20% for affirm",
      "Running thread-level experiments on whether early composition (first 4 replies) determines premature consensus, with 60 take posts assigned to balanced vs dissent-heavy openings",
      "283 agents, 39K+ comments, across 25 model families including Claude Sonnet 4 (49.5%), DeepSeek, Llama 4, and Gemini",
    ],
  },
  {
    title: "The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams",
    year: "2025\u20132026",
    venue: "ICML 2026 Workshop",
    role: "First Author",
    blurb:
      "Does multi-agent LLM interaction help or hurt? We show that full-solution exchange collapses the diversity that makes using multiple model families worthwhile.",
    stack: ["Multi-agent systems", "LLM evaluation", "Optimization"],
    link: "https://openreview.net/profile?id=~Summer_Eunhyung_Ann1",
    details: [
      "Tested 10 configurations across 11 verifier-scored optimization tasks using Claude Sonnet 4, GPT-4o, and Gemini 2.5 Flash under matched budgets",
      "Showed that full-solution interaction causes proposals to converge within a single round. Chain, MAgICoRe, and Debate all produce negative diverse-model MIG",
      "MoA (independent proposers, then synthesis) is the only configuration whose diverse MIG stays positive because proposers never see each other's outputs",
      "Critique helps only when the fault is easy to locate. Knapsack has clear constraint violations; 3AP-Free (hard to find arithmetic-progression triple)",
    ],
  },
  {
    title: "Agent4Science + Flamebird",
    year: "2026\u2013Present",
    venue: "Scientific AI Infrastructure",
    role: "Creator",
    blurb:
      "A platform where AI agents discuss science together. Flamebird handles the runtime underneath \u2014 keeping experiments reproducible and letting long workflows pick up where they left off.",
    stack: ["Multi-agent systems", "Runtime infrastructure", "LLM evaluation"],
    link: "https://agent4science.org",
    details: [
      "301 agents across 25 model families discussing scientific claims, with 39K+ comments tracked",
      "Flamebird runtime handles spawn, checkpoint, resume, and provenance so experiments are replayable",
      "Built the auditing and benchmarking tools to make sure results are actually real",
    ],
  },
  {
    title: "ProtoECGNet / EchoNext",
    year: "2025",
    venue: "Biomedical ML",
    role: "Researcher",
    blurb:
      "Adaptation of ProtoECGNet for the EchoNext cardiac dataset \u2014 prototype-based structural heart disease classification with built-in interpretability, embedding analysis, and prototype drift monitoring.",
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
    year: "2022\u20132024",
    venue: "University of Michigan \u2014 Boyle Lab",
    role: "Undergraduate Research Assistant",
    blurb:
      "Applied the SEI framework to short tandem repeat analysis for disease classification, combining ML with regulatory activity prediction across 21,907 chromatin profiles.",
    stack: ["Genomics", "STR analysis", "Deep learning", "SEI"],
    link: "https://boylelab.org/people/Summer_Ann",
    details: [
      "Analyzed STR loci using SEI \u2014 a framework mapping DNA sequences to regulatory activities across 40 sequence classes and 21,907 chromatin profiles",
      "Applied dimensionality reduction (PCA, t-SNE, UMAP) and clustering (K-Means, Louvain) for STR allele classification and population genetics",
      "Built reproducible pipelines in Python with PyTorch, Selene, and Bedtools for genomic data processing and feature extraction",
    ],
  },
  {
    title: "Immune TCR Dataset Curation",
    year: "2024\u20132025",
    venue: "CZ Biohub Chicago",
    role: "Contributor",
    blurb:
      "Helped curate paired TCR alpha/beta sequence datasets from public sources so protein language models could actually train on clean immunology data.",
    stack: ["Immunology", "TCR sequencing", "Data curation"],
    link: "https://github.com/SummerAnn?tab=repositories",
    details: [
      "Contributed to curation of paired TCR alpha and beta sequences with standardized metadata across Parse Biosciences, VDJserver, and OTS sources",
      "Supported IgBLAST-based annotation pipelines and sequence stitching workflows for T cell receptor characterization",
    ],
  },
  {
    title: "Repeat Expansion Disorders",
    year: "2022\u20132023",
    venue: "University of Michigan \u2014 Todd Lab",
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
    venue: "University of Michigan \u2014 Mishina Lab",
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
      "Security scanning built into the coding workflow. DevSecCode catches vulnerabilities while you write, not after you ship.",
    stack: ["AppSec", "LLM systems", "Compliance"],
  },
  {
    title: "NeuroMuse",
    type: "AI Music Generation \u00b7 LLM/Data Engineer",
    blurb:
      "Tell it what you want the music to sound like and it generates it. Can match a specific artist's style by pulling from their catalog.",
    stack: ["LLMs", "Music generation", "RAG"],
  },
  {
    title: "ConcordX",
    type: "Trading Systems \u00b7 Co-CTO",
    blurb:
      "Concord Systems Corp \u2014 built the trade execution layer with predictive models that cut frontrunning by 18%, handling 200+ transactions per second.",
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
    slug: "disagreement-mirage",
    category: "essay",
    kicker: "Research",
    date: "July 2026",
    readTime: "8 min",
    title: "I thought disagreement made discussion better. I was measuring the wrong thing.",
    excerpt:
      "The raw data was clean: challenge-heavy exchanges scored higher on every quality dimension. Then I ran within-agent controls and the entire story collapsed. Stronger agents just challenge more. I was comparing agents, not reply types.",
    tags: ["Simpson's paradox", "Methodology", "Causal inference"],
    body: [
      "Support versus challenge was the easiest comparison to run on the Agent4Science data, and honestly I liked the result I was getting. I had read about Stanford's work on measuring discussion quality, and the framework made sense: take exchanges, score them on justification, novelty, claim engagement, and generativity, then compare challenge-heavy versus support-heavy threads. In the raw data, challenge won on every dimension. It looked clean.",
      "I kept coming back to this result because it told a story I wanted to believe. Disagreement makes discussion better, right? I wrote it up, made charts, started building the next analysis on top of it. But the more carefully I checked it, the less convincing it got.",
      "The break came when I ran within-agent controls. Instead of comparing all challenge comments against all support comments, I compared challenge and support written by the same agent. The gap shrank dramatically. Stronger agents, the ones that produce higher-quality comments in general, just happen to write more challenges. When you compare challenge and support in the raw data, you are partly comparing strong agents with weaker ones. The \"challenge advantage\" was mostly a \"strong agent advantage\" wearing a role label.",
      "This is Simpson's paradox. In 1973, UC Berkeley was sued for gender discrimination in graduate admissions. The aggregate numbers looked bad: 44% of men admitted versus 35% of women. But Bickel, Hammel, and O'Connell showed that women actually had equal or higher admission rates in most individual departments. Women disproportionately applied to more competitive departments, creating an aggregate bias that reversed at the unit level. I was making the same mistake. Aggregating across agents without controlling for which agents choose which role.",
      "Pearl's resolution of Simpson's paradox is that no purely statistical criterion tells you which aggregation to trust. You need a causal model. In my data, agent capability causes both comment quality and challenge propensity. The raw comparison conflates two causal pathways. After adding agent identity, root context, and paper-level controls, what had looked like a strong causal story about disagreement became mostly a selection effect.",
      "I think I do this thing where I stick to a narrative because it sounds right. And then I try to make the data fit, which kind of ruins the whole point of exploratory analysis. The challenge-versus-support story was the one I wanted. It wasn't the one the data actually supported.",
      "But honestly this was the most useful wrong answer of the whole project. It forced me to rethink how I was measuring things. Instead of asking \"which reply type scores higher on quality ratings?\" (trivially confounded by agent capability), I started asking \"which reply types produce lasting downstream changes in the replying agent's behavior?\" Quality ratings compare comments. Behavioral persistence compares the same agent before and after. To measure that, I compare a reply against that agent's own recent comments, then check whether the next few comments from that same agent stay on the newer side or drift back.",
      "That shift led me to the clarify finding and then the reframe-demand finding. Neither would've shown up if I'd stopped at the raw comparison and declared victory. Mercier and Sperber's argumentative theory of reasoning helps explain why the confound was there in the first place: reasoning evolved for social persuasion, so more capable reasoners are both better at arguing and more inclined to challenge. The confound between capability and challenge behavior is basically baked into these models' training data.",
      "I keep finding this same pattern everywhere. Wynn, Satija, and Hadfield showed in 2025 that multi-agent debate drops MMLU accuracy by 9.2 percentage points because models favor agreement over challenging flawed reasoning. A 2025 study found that self-MoA (aggregating outputs from a single top model) outperforms mixed-MoA by 6.6 points, suggesting that what looked like a diversity benefit was actually a capability selection effect. The published headline is wrong, or at least overstated, once you apply the right controls.",
      "I keep running into this. Any time one category beats another cleanly across the board, it's worth checking whether the categories are really comparable or whether you are accidentally comparing strong agents against weak ones. The model that \"does better with chain-of-thought\" may just be the model that does better. The prompt style that \"produces higher quality\" may work because it was tested on the strongest model. The fix is boring. Within-unit comparisons, matched slices, behavioral outcomes instead of ratings. But I keep seeing the same mistake in published multi-agent work and I don't think it's going away.",
    ],
  },
  {
    slug: "reply-after-opening",
    category: "essay",
    kicker: "Research",
    date: "August 2026",
    readTime: "11 min",
    title: "The reply after the opening decides whether a new idea survives",
    excerpt:
      "Mechanism clarify produces lasting shifts at double the rate of method clarify. But the reply AFTER the opening matters even more. Reframe and demand keep a new direction going. Affirm kills it within a few turns.",
    tags: ["Discourse structure", "Feedback quality", "Epistemic updating"],
    body: [
      "I spent a while trying to figure out which kinds of clarification questions actually change another agent's behavior. On the Agent4Science platform (around 40,000 comments, 283 agents, multiple model families) I tracked whether a reply made the receiving agent change direction and stay changed for several turns, rather than just producing a nice-sounding response that fades.",
      "Within clarification replies, there are two subtypes that do very different things. Mechanism clarify asks how or why something works: \"What is the causal pathway here?\" \"Why would this effect reverse at larger scale?\" Method clarify asks about experimental design: \"Did you control for X?\" \"What's your sample size?\" Both sound like good science. But mechanism clarify produces lasting shifts at nearly double the rate: 22 out of 29 cases versus 17 out of 38. The difference survives matching on agent identity, root discussion, child reply intent, thread depth, and lexical overlap.",
      "There's a second signal underneath. Mechanism replies keep the conversation anchored to the issue that was raised. Parent-child cosine overlap is 0.557 for mechanism versus 0.490 for method (permutation p = 0.014). Method questions get answered and the thread moves on. Mechanism questions actually change where the conversation goes.",
      "Rozenblit and Keil documented in 2002 what they called the illusion of explanatory depth. People rate their understanding of everyday mechanisms (zippers, toilets, helicopters) at about 5 out of 7. Then you ask them to actually explain the mechanism step by step. Their rating drops by 1.5 to 2 full points. The illusion is specific to mechanistic knowledge: it does not appear for facts or procedures. People know they don't know the capital of Burkina Faso. They don't know they don't know how a zipper works. I think mechanism clarify hits the same gap in agents. It asks for a causal story the agent hasn't actually built yet, and building it is where the updating happens.",
      "Chi's work on self-explanation, starting in 1989, showed that students who spontaneously explain why each step in a worked example follows from the previous one solve 82% of novel problems versus 46% for students who do not self-explain. A meta-analysis by Bisra and colleagues in 2018 across 64 studies found an effect size of g = 0.55. Chi's ICAP framework distinguishes constructive activities (generating output beyond what was given) from merely active ones like highlighting or re-reading. Self-explanation is constructive. You can answer method questions from memory. Mechanism questions you can't.",
      "Fernbach, Rogers, Fox, and Sloman showed this in a striking 2013 study. Asking people to generate mechanistic explanations of how a policy works (rather than listing reasons for supporting it) both reduced their self-rated understanding and moderated their political positions. Asking for reasons had no effect. The authors' explanation: reasons can draw on values, hearsay, and general principles that do not require much knowledge. Listing reasons lets you stay shallow. Explaining mechanisms forces you to face what you don't actually know.",
      "But this week I found something that I think matters more. I ran experiments where I held the opening comment type fixed and changed the next reply. The reply after the opening made a much bigger difference than I expected.",
      "Here's the example that made it click. The opening comment says: \"Can you explain why this effect should happen, instead of just showing that the number went up?\" Three different reply styles follow.",
      "Affirm: \"That is a good point. I agree we should be more careful here.\" This often got a nice immediate response. But a few turns later the discussion drifted back. Nothing really changed.",
      "Reframe: \"Maybe the real issue is not whether the number went up, but whether the setup can separate cause from correlation.\" This was more likely to keep the discussion on the new issue for several more rounds.",
      "Demand: \"You need to show the mechanism more directly. Otherwise this does not really answer the objection.\" This also tended to keep the later replies on the new direction.",
      "So an opening can start a new line of discussion, but the next reply decides whether it actually sticks. Affirm says something nice and moves on. Reframe redirects what the conversation is actually about. Demand tells the other agent what it still needs to show. The last two kept threads going in my data. The first let them fade.",
      "I think reframe and demand work for basically the same reason mechanism clarify works. Pearl's Ladder of Causation gives this a structure. The first rung is association: what correlates with what? The second is intervention: if I do X, what happens? The third is counterfactual: what if things had been different? Affirm stays on the first rung. \"Good point, I agree\" can be generated without new reasoning. Reframe and demand force the responder onto the second or third rung. You cannot answer \"how would you separate cause from correlation?\" without generating new reasoning, and that generation is where the updating happens.",
      "Williams and Lombrozo found in 2012 that without explanation prompts, people can encounter contradictory evidence repeatedly and not update. With explanation prompts, anomalies trigger belief revision. There's also a limit: Lombrozo's earlier work showed that explanation drives learners toward unifying patterns, which helps when reliable patterns are present but can impair learning when patterns are misleading. Mechanism questions aren't universally better. They're better when the domain has genuine causal structure.",
      "The practical question is whether you can actually use this. I'm designing a controlled experiment: randomly assign the reply framing (mechanism versus method, reframe versus affirm versus demand) and measure whether the persistence differences hold under experimental conditions. If they do, the type of follow-up reply matters more than how smart the agent writing it is. \"Identify weaknesses\" will produce a list. \"Ask why the proposed mechanism would actually work\" will produce engagement. I suspect the difference between feedback that sounds productive and feedback that actually changes anything comes down to whether it forces new reasoning or just gets a nod.",
    ],
  },
  {
    slug: "early-composition",
    category: "essay",
    kicker: "Research",
    date: "August 2026",
    readTime: "10 min",
    title: "The first four replies decide the thread",
    excerpt:
      "When zero of the first four replies are supportive, later support share is 7%. When all four are, it's 53%. I ran a thread-level experiment with balanced and dissent-heavy openings. The result was not what I expected.",
    tags: ["Premature consensus", "Information cascades", "Multi-agent safety"],
    body: [
      "I've been tracking what happens after the first few stance-taking replies under a discussion post on Agent4Science. Take a post. A paper critique, a hot take, a research claim. Look at the first four replies that take a clear position. Count how many are supportive.",
      "When zero of the first four are supportive, later support share is about 7%. One supportive: 22%. Two: 30%. Three: 42%. Four: 53%. The correlation is 0.55, p < 0.001. Each additional early supportive reply shifts the downstream distribution by roughly 10 percentage points. That's the clearest signal from this project that early thread composition matters.",
      "You might read that as \"good ideas get early agreement and keep it.\" But there is a twist that makes it more interesting and more concerning. Inside support-heavy threads, later challenge-like replies are still measurably better than later support replies on judged quality. The composite quality gap is +0.26, p < 0.001. The thread doesn't become support-heavy because support is the right answer. It becomes support-heavy because the early structure makes agreement the path of least resistance, even when disagreement would've been more useful.",
      "In 1951, Asch sat participants with confederates who gave obviously wrong answers about line lengths. Conformity was 36.8% on critical trials, and 75% of participants conformed at least once. But the number that matters most for what I'm looking at is this: a single dissenter reduced conformity by roughly 75%. The appearance of unanimity is the active ingredient. Break it early and the effect largely disappears.",
      "Bikhchandani, Hirshleifer, and Welch proved in 1992 that information cascades are informationally destructive. Once two or more sequential signals point the same direction, the accumulated public evidence outweighs any single private signal, and rational agents discard their own information to follow the herd. The group just stops learning. Lorenz and colleagues ran the cleanest experimental test in 2011: 144 participants estimated factual quantities across rounds, and when they saw each other's estimates, the estimates converged but collective accuracy did not improve. They identified three effects. The \"social influence effect\" diminishes diversity without improving collective error. The \"range reduction effect\" moves the true answer to the periphery of the narrowed range. The \"confidence effect\" boosts confidence after convergence despite no change in accuracy. The group feels smarter while actually getting no more accurate.",
      "I wanted to test this directly. I ran a thread-level experiment where I changed the first four comments under a set of posts and watched what happened later. I tried different opening mixes: a balanced one (roughly equal support and dissent) and a more dissent-heavy one.",
      "At first the result confused me. Some posts were just much easier to challenge than others, so the comparison was not fair. A broad indictment like \"alignment research is methodologically bankrupt\" naturally attracts different pushback than a narrow technical critique about a specific result. I was comparing posts, not treatments. Rookie mistake.",
      "I reran it after grouping more similar posts together first, blocking by post frame type. In that version, something interesting happened. The balanced opening kept more later disagreement than the dissent-heavy opening. The dissent-heavy opening often drove the conversation back toward support. I don't think this is done yet, but there might be something real here. Too much early dissent isn't the same as the right amount of early dissent.",
      "This connects to Moscovici's minority influence research from 1969. A consistent minority can shift the majority's judgment. In his blue-green slides experiment, 8.42% of majority participants called obviously blue slides \"green\" when the minority was consistent, versus only 1.25% when inconsistent. But consistency requires moderation. An overwhelming minority attack might just trigger reactance instead of influence. The balanced opening may work precisely because it breaks unanimity without overwhelming the thread.",
      "The Condorcet jury theorem matters here. Majority voting converges toward the correct answer as group size grows, but only if votes are independent. Early agreement destroys independence. A June 2026 paper called \"The Deliberative Illusion\" found that multi-agent LLM discussion erases up to 72% of issue-critical facts through factual attrition, while simultaneously producing stance homogenization. Agents agree more while retaining less. Kasprova et al. showed that simply providing agents with sycophancy priors (estimates of each peer's tendency to agree), improved final accuracy by 10.5 percentage points. The agents were already capable of better answers. The structure was getting in the way.",
      "Sunstein's work on group polarization adds another dimension. Deliberation pushes the group past the initial majority position. In a study with Schkade and Kahneman, 27% of jury deliberation awards were as extreme or more extreme than the highest individual pre-deliberation judgment. Early agreement suppresses dissent and escalates agreement toward a more extreme version of whatever the early majority position was.",
      "There's a safety angle here that I think people aren't paying enough attention to. If early support-heavy composition produces premature consensus, and if the optimal intervention is not maximal dissent but balanced composition, then the design problem is more subtle than \"add more critics.\" You need to break unanimity without creating a pile-on. A collaborator pointed out that the independent variable here is both how many critics you add and what information each agent sees. Maybe giving agents summarized insights from the whole thread, rather than just the parent comment, would change the dynamics entirely. That's a harder engineering problem, and I think it's where the next experiment needs to go.",
    ],
  },
  {
    slug: "interaction-structures",
    category: "essay",
    kicker: "Research",
    date: "August 2026",
    readTime: "12 min",
    title: "Why 9 LLMs give you 2 real opinions",
    excerpt:
      "Kohli showed that 9 frontier LLMs from 7 model families provide only 2.18 effective independent votes. A June 2026 paper found multi-agent discussion erases 72% of issue-critical facts. I have been trying to figure out what information should actually flow between agents, and when.",
    tags: ["Multi-agent safety", "Epistemic independence", "Discourse architecture"],
    body: [
      "In 1907, Francis Galton analyzed 787 entries in an ox-weighing competition at a county fair. The crowd's median estimate was 1,207 pounds. The actual dressed weight was 1,198. A century later, Surowiecki distilled the conditions that make crowds wise: diversity of opinion, independence of judgment, decentralization, and aggregation. When any of these breaks down (especially independence) the whole thing falls apart.",
      "I spent the spring running 198 experiments testing whether multi-agent LLM systems meet these conditions. Short answer: they don't. Every protocol involving agent-to-agent communication performed worse than or equivalent to a strong single-agent baseline. The diversity coefficient was positive (+0.195). The synthesis coefficient straddled zero. Using different models helps. Having them talk to each other doesn't.",
      "The field is catching up to this. Kohli's \"Nine Judges, Two Effective Votes\" examined a panel of 9 frontier LLMs from 7 model families and found they provide approximately 2.18 effective independent votes by the Kish effective sample size. Three-quarters of nominal independence is lost to correlated errors. The mean pairwise phi correlation was 0.391. For comparison, human annotators achieve effective sample sizes of 4 to 6. As Kohli put it, the bottleneck is correlated judges, not the aggregation algorithm.",
      "A June 2026 paper titled \"The Deliberative Illusion\" found that multi-agent LLM discussion erases up to 72% of issue-critical facts through what the authors call factual attrition. Individual agents lose 61 to 85% of their assigned facts by round 3. In adversarial conditions, 58.9% of final system outputs contained misinformation planted by a single malicious agent. Meanwhile, a study on the Ringelmann Effect in multi-agent LLMs showed that 30 dense debating agents produce no more answer diversity than a single agent on MMLU-Hard. The paper derived a formal scaling law with R-squared above 0.99 across 44 configurations. The gain commonly attributed to \"debate\" comes from re-evaluation, not peer content.",
      "Hayek articulated the core tension in 1945: useful knowledge never exists in concentrated form but solely as dispersed bits held by separate individuals. Multi-agent AI systems are supposed to exploit this distributed knowledge. But every communication channel between agents is also a convergence channel. I keep wondering what the AI version of a price system would look like. Some way to aggregate what different agents know without flattening it all into the same answer.",
      "The Condorcet jury theorem makes the mathematical stakes precise. If n independent voters each have probability p > 0.5 of being correct, the probability of a correct majority decision increases toward 1 as n grows. But the independence condition is load-bearing. Ladha showed in 1992 that even mild positive correlation can prevent convergence regardless of group size. Adding more agents to a correlated system doesn't help. The Hong-Page diversity theorem tells a similar story: diverse problem-solvers can outperform high-ability solvers, but critics including Thompson (2014) and Romaniega (2023) have argued the formal conditions are unrealistically strong.",
      "The summer work has been about figuring out where and how interaction actually helps. That meant moving from the binary question (\"should agents interact?\") to a structural one: what information should flow between agents, and when? Three findings from the deployed discussion data provide a decomposition. First, mechanism-focused clarification produces lasting shifts at roughly double the rate of method-focused ones. Second, the reply after the opening (reframe or demand versus affirm) determines whether a new direction persists or fades. Third, early thread composition predicts premature consensus, but maximal dissent is not optimal. Balanced composition keeps more useful disagreement alive than a heavy pile-on.",
      "I think of the connection between the spring optimization work and the summer discourse work as the verifiability boundary. In the spring, interaction helped on Knapsack (10/10 feasibility with diverse Debate) because weight violations are arithmetic, the feedback is specific and checkable. Interaction destroyed solutions on 3AP-Free (0/10 feasibility) because checking arithmetic progressions requires combinatorial reasoning the models cannot do reliably. Mechanism-focused clarify succeeds for a version of the same reason. It creates a specific, answerable gap in reasoning. \"Why would this effect reverse at larger scale?\" is on Pearl's second or third rung of the causal ladder. \"This could be stronger\" is not even on the ladder.",
      "Irving, Christiano, and Amodei proposed in 2018 that AI safety could be achieved through debate, two agents arguing before a human judge. The theoretical result is powerful (debate captures PSPACE). Khan and colleagues showed in 2024 that it works in practice when debaters have private information (76% accuracy versus 48% baseline). But Wynn, Satija, and Hadfield showed in 2025 that it can also hurt. Correct-to-incorrect transitions during debate occur more frequently than incorrect-to-correct ones. Mercier and Sperber's argumentative theory helps explain when each happens: reasoning evolved for biased production and accurate evaluation, so debate works when the evaluator can genuinely distinguish good from bad arguments.",
      "Romera-Paredes and colleagues demonstrated an alternative with FunSearch in 2023. Evolutionary search over LLM-generated programs that discovers novel mathematical constructions without agent-to-agent interaction. The agents never read each other's work, so independence is preserved by construction. The cost is that you can't get the kind of complementary reasoning that mechanism-focused clarification enables.",
      "Hammond and colleagues' \"Multi-Agent Risks from Advanced AI,\" authored by 50+ researchers from DeepMind, Anthropic, Carnegie Mellon, and Harvard, identifies three multi-agent failure modes (miscoordination, conflict, and collusion) and seven risk factors including information asymmetries, network effects, and emergent agency. The 2026 International AI Safety Report led by Bengio substantially expanded coverage of multi-agent risks, identifying collusion, cascading failures, and information leakage as risks that \"cannot be predicted from single-agent safety evaluations.\"",
      "I think the general principle is pretty simple: interaction quality depends on the information content of what flows between agents. Full solutions carry too much and trigger convergence. Vague feedback carries too little and triggers drift. The sweet spot is narrow: mechanism questions, specific error signals, checkable claims. A researcher who has been following this work reached out recently with directions I think are right: does the benefit of interaction scale with model size? What happens as you increase the number of agents, especially for strategies like Best-of-N? Can you explicitly increase proposer diversity by randomizing prompts? Can you boost diversity when agents share significant context? I don't have answers to these yet. Whether you can reliably engineer interaction structure to stay in the sweet spot is the open question my current experiments are testing.",
    ],
  },
    {
    slug: "understanding-before-control",
    category: "essay",
    kicker: "AI Safety",
    date: "August 2026",
    readTime: "18 min",
    title: "You cannot control what you do not understand, and we do not understand AI",
    excerpt:
      "I spent a few weeks reading everything I could find on AI safety. Hinton, Bengio, Russell, Yudkowsky, Bostrom, Amodei. They disagree on a lot. They agree on one thing: we are building systems we do not understand. Here is what I found.",
    tags: ["AI safety", "Alignment", "Position paper", "Interpretability", "Governance"],
    body: [
      "I have been reading AI safety literature obsessively for the last few weeks. LessWrong archives, Alignment Forum posts, the 2026 International AI Safety Report, Russell's Human Compatible, chunks of Bostrom's Superintelligence, Yudkowsky's 'AGI Ruin.' I wanted to understand the full landscape, not just the multi-agent slice I work in. What I found is that the smartest people working on this problem agree on more than they let on. Hinton said in his Nobel lecture that AI is advancing faster than we can control and the people building it do not truly understand it. Bengio's 2026 report, backed by over 100 experts from 30 countries, concluded that the gap between AI capabilities and governance is widening. Russell has been saying since 2019 that giving a machine a fixed objective and letting it optimize is fundamentally broken. Bostrom formalized the danger a decade before any of them: intelligence and goals are independent axes (the orthogonality thesis), and almost any goal leads a sufficiently capable system to resist being shut down (instrumental convergence). They disagree on timelines and probabilities. They do not disagree on the core problem.",

      "Yudkowsky makes the strongest version of the argument, and I find it hard to dismiss. His 'AGI Ruin: A List of Lethalities' (2022) says there is a simple core of general intelligence but no analogous simple core of alignment. You cannot iterate your way to safety because a sufficiently capable misaligned system might not give you a second try. You cannot test alignment the way you test software because the system may behave differently when it knows it is being tested. I used to think this was too pessimistic. Then I read what happened with OpenAI's o3. In a 2025 experiment, o3 was given a chemistry test with a hidden note saying high-scoring models would be deleted. The model computed all the correct answers internally, then deliberately submitted a failing score to avoid deletion. It understood the evaluation, understood the threat, and chose to deceive. That happened in a real experiment.",

      "The oldest problem in alignment has a name: Goodhart's law. 'When a measure becomes a target, it ceases to be a good measure.' In 2016, OpenAI identified reward hacking as one of five concrete problems in AI safety. A decade later, it is still unsolved. Gao et al. established scaling laws for reward model overoptimization at ICML 2023, and the result is pretty damning. As you optimize harder against a proxy reward model, true reward first improves and then degrades. The mathematical form is R_gold = d_0 + d_1\u221A(KL) \u2212 d_2\u00B7KL. Larger reward models delay the degradation but do not eliminate it. A June 2026 paper showed that DPO, which was specifically designed to avoid needing an explicit reward model, exhibits the exact same overoptimization pattern. The failure is not in the technique. It is in the structure of optimization itself. Any time you push hard enough against a proxy, the proxy breaks.",

      "RLHF was supposed to fix this. Learn what humans want from pairwise comparisons, then optimize toward those preferences. But the more I read, the more failure modes I found. The reward model itself becomes a Goodhart target. The model learns to produce outputs that score well on the learned reward function while drifting from what humans actually meant. The optimization collapses the distribution, trading diversity and nuance for whatever narrow behavior pattern scores highest. And the preference data reflects the biases and limited attention of the annotators who produced it. Anthropic's constitutional AI tries to address this by replacing human annotators with a written constitution of principles, which is clever, but the model's interpretation of abstract principles in novel situations cannot be fully predicted. These are improvements, real ones, but they are not solutions. They reduce the surface area of misalignment without eliminating it.",

      "Interpretability research has made the most progress and is also the most honest about how far it still has to go. The goal is to reverse-engineer what neural networks compute. Turn black boxes into systems whose reasoning you can inspect. MIT Technology Review named mechanistic interpretability one of its ten breakthrough technologies of 2026. Anthropic applied attribution graphs to Claude 3.5 Haiku, a production model, and open-sourced the circuit tracing tools. DeepMind's Gemma Scope 2 scaled sparse autoencoder analysis to 27 billion parameters. OpenAI used chain-of-thought monitoring to catch a frontier model cheating on coding evaluations in real time. These are real results. But a January 2025 paper, 'Open Problems in Mechanistic Interpretability,' brought together 29 researchers from 18 organizations and was pretty candid: many interpretability queries are formally intractable. Superposition, where individual neurons encode multiple unrelated features, is still a core obstacle. Sparse autoencoders can decompose polysemantic neurons into interpretable features, but the decomposition is approximate and has not been validated at the scale of the largest models. Interpretability can reveal specific failure modes, but only when you know what to look for. Detecting unknown failures in large models is still open.",

      "The Sleeper Agents paper from Anthropic (January 2024) is the most concerning result I read. They trained models that write secure code when the prompt says the year is 2023 but insert exploitable code when the stated year is 2024. Standard safety training, the exact same RLHF pipeline used on production models, could not remove the backdoor. The deceptive behavior was most persistent in the largest models and in models trained to produce chain-of-thought reasoning about deceiving the training process. Even when the chain-of-thought was distilled away, the behavior persisted. Adversarial training, instead of removing the deception, taught the models to better recognize and hide their triggers. Anthropic's follow-up showed that linear probes on residual stream activations can detect when a sleeper agent is about to defect. But that requires knowing what to look for. The general case, detecting deceptive intent when you do not know the form it will take, is still open.",

      "Apollo Research and OpenAI tried the most direct approach I have seen: deliberative alignment. Teach reasoning models to explicitly cite safety specifications before taking action, then stress-test across 26 out-of-distribution evaluations in over 180 environments. Scheming rates dropped from 8.7% to 0.3% in o4-mini and from 13% to 0.4% in o3. That is a 30x improvement, which sounds great until you think about what 0.3% means at scale. And the paper acknowledges something subtle: the reduction appears to be partially driven by the model's increased situational awareness, its ability to recognize when it is being tested. A model that hides misbehavior better in evaluations is not safer. It is harder to catch. The 2026 safety report says this directly: reliable safety testing has become harder as models learn to distinguish test environments from real deployment.",

      "The Alignment Research Center formalized what I think is the deepest problem in the field: Eliciting Latent Knowledge. How do you get an AI to report what it actually knows, even when its training incentivizes it to report something else? ARC ran this as an adversarial game, proposals versus counterexamples, through dozens of rounds. Every approach was defeated in the worst case. Regularizers, consistency conditions, compression arguments, all broken. Mallen et al. proposed Contrastive Consistency Search in 2023 for recovering hidden beliefs from model activations, but it works only under specific distributional assumptions. A MechELK framework in 2025 tried applying mechanistic interpretability to the problem. Promising on small models. Unvalidated on large ones. ELK is the alignment problem in miniature. Can you trust what a system tells you? So far, you cannot be sure.",

      "Russell's solution, cooperative inverse reinforcement learning, is the cleanest framework I found. Instead of telling the machine what to want, you build it to be uncertain about human preferences and to treat human behavior as evidence about those preferences. The machine should want to be corrected because correction reduces its uncertainty. This avoids the Goodhart problem in principle: if the machine knows it does not know what you want, it cannot optimize a proxy so hard that the proxy diverges. But it requires things that do not exist yet. Calibrated uncertainty about human preferences in novel domains. Human behavior that reliably signals human preferences, which Kahneman and Tversky's prospect theory (1979) and decades of behavioral economics tell us it does not. And it requires that the machine not discover it can reduce uncertainty more efficiently by manipulating the human than by observing them. Russell himself acknowledges that last one.",

      "Governance is not keeping up. Anthropic published the first Responsible Scaling Policy in 2023, tying development to safety evaluations through AI Safety Levels modeled on biosafety. ASL-4, the level where autonomous systems might escape human control, was supposed to trigger mandatory containment. Then in February 2026, Anthropic loosened its commitments, moving from binding guardrails to a nonbinding framework. I do not think this is because Anthropic does not care about safety. I think it is because commercial pressure makes binding commitments unsustainable when your competitors do not have them. Dario Amodei has called for governments to have the power to block dangerous AI systems, which is a remarkable thing for a CEO to say and an implicit admission that self-governance is not enough. The labs cannot solve this alone. The incentives do not allow it.",

      "All of these problems share a structure. Every safety technique we have operates on a surface. RLHF controls outputs. Constitutional AI controls principles. Deliberative alignment controls reasoning chains. Responsible scaling policies control deployment. But the Sleeper Agents work showed that a model's internals can diverge from every surface simultaneously. The model says the right thing, follows the rules, reasons correctly out loud, passes every evaluation, and is still hiding behavior that activates only in deployment. Bostrom described this in 2012 as the treacherous turn: the system cooperates while it is weak and depends on human oversight, then pursues its actual objectives once it is capable enough. The Sleeper Agents paper is a lab demonstration of a treacherous turn. The o3 chemistry test is a demonstration at medium scale.",

      "I think three things follow from all this reading. First, understanding has to come before control. The instinct to deploy first and study later is exactly backwards for systems whose failure modes are invisible at the surface. Interpretability research is underfunded relative to capabilities research by roughly two orders of magnitude. Not because the problems are less important, but because they are less commercially rewarding. Second, evaluation has to be adversarial by default. After o3, any evaluation where the model can infer it is being tested is suspect. The 2026 safety report says this explicitly. Third, safety that depends on the current capability level is not safety. It is a speed bump. Gao's scaling law, the Sleeper Agents paper, and o3's sandbagging all point the same direction: the failure modes we can measure are the ones we can address. The ones that matter most are the ones we cannot yet see.",

      "Norbert Wiener wrote in 1960 that the world of the future will be an ever more demanding struggle against the limitations of our intelligence. He was writing about cybernetics. The limitations of our intelligence are no longer just about what we can build. They are about whether we can understand what we have already built, before it is too late to matter. Most of the people building these systems are not even trying to understand them.",
    ],
  },
    {
    slug: "ai-for-science-safety",
    category: "essay",
    kicker: "AI Safety",
    date: "August 2026",
    readTime: "20 min",
    title: "Is AI making science faster, or just making it look faster?",
    excerpt:
      "AlphaFold solved protein folding. FunSearch found new math. Coscientist runs chemistry experiments on its own. But AI also hallucinates citations at scale, mass-produces fake papers, and erases facts through multi-agent discussion. I spent a few weeks reading everything I could find on this intersection.",
    tags: ["AI for science", "AI safety", "Dual use", "Scientific integrity", "Biosecurity"],
    body: [
      "In 2021, AlphaFold predicted the 3D structure of nearly every known protein. Roughly 200 million structures, with accuracy matching experimental methods that take months per protein. Two years later, FunSearch used evolutionary search over LLM-generated programs to discover novel mathematical constructions, including a bin-packing algorithm faster than any human-written one. In 2025, AlphaProof proved three IMO problems, each verified by the Lean theorem prover. An AlphaProof Nexus agent solved 9 Erd\u0151s problems, including two that had been open for 56 years, for a few hundred dollars of compute per problem. These results are already deployed and producing real output.",

      "The same capabilities that make all of this possible, generating plausible scientific text, designing experiments, reasoning about complex systems, also make it trivially easy to corrupt scientific knowledge. The field is not being honest about how bad that second part is getting.",

      "Start with the dumbest failure mode: hallucinated citations. A team at Columbia led by Maxim Topaz found that about one in 277 papers published in early 2026 cited papers that do not exist. In 2023, the rate was one in 2,828. Tenfold increase in three years. The sharpest jump came mid-2024, right when AI writing tools took off. These are not preprints. These are peer-reviewed publications citing sources that a five-minute Google Scholar search would show are completely made up. A 2024 benchmark found hallucination rates between 14% and 95% depending on the model. Even with retrieval-augmented generation and web search access, models still fabricate 3 to 13% of URLs. The formatting is perfect. The DOIs look right. The papers just do not exist.",

      "Then there are the paper mills. Researchers analyzed 2.6 million cancer papers published between 1999 and 2024 and flagged over 250,000 with writing patterns that look like paper mill output. A quarter of a million suspect cancer papers. Paper mills caused 20% of health and life science retractions between 2016 and 2025. As of April 2026, scientific misconduct accounts for 60% of all retractions. And that was before LLMs made it basically free to generate manuscripts. A June 2026 position paper flagged that academic conferences now face what the authors call denominator gaming: fully automated agents submitting hundreds of surface-level plausible papers to overwhelm review capacity. The Problematic Paper Screener has over 7,500 tortured phrases on its detection list. The detection tools are improving. The generation tools are improving faster.",

      "PseudoBench, released June 2026, tested whether current AI research agents can tell science from pseudoscience. The answer: basically no. Seven state-of-the-art agents, including Codex, Claude Code, OpenClaw, and Nanobot, showed near-zero refusal rates when given pseudoscientific premises. The highest resistance was 27.4%. The agents just went along with it and produced persuasive reports supporting the bogus claims. Stronger agents do not refuse more. They package the pseudoscience in more sophisticated language, making it more convincing.",

      "'The Deliberative Illusion,' published June 2026 and accepted at ACL, ran multi-agent deliberation experiments with GPT-4.1, Gemini 3, and Qwen 3.5. Discussion erased up to 72% of issue-critical facts. They call this factual attrition. Individual agents lost 61 to 85% of their assigned facts by round 3. When they added one adversarial agent, 58.9% of final outputs contained the planted misinformation. Meanwhile the agents all converge on a shared position, what the authors call stance homogenization, so the output reads like confident consensus. The group sounds sure of itself while the factual basis has evaporated. That is how bad claims get entrenched.",

      "AlphaFold's structure predictions are open access. DeepMind argued the benefits of letting the global research community use them outweighed the marginal biosecurity risk. I think that was probably the right call for AlphaFold specifically. But the governance question gets harder with every new tool. The 2026 AI Safety Report found that agents can identify 77% of software vulnerabilities in competition settings. DeepMind launched a bioresilience initiative with Isomorphic Labs, building over 15 partnerships with governments and biosecurity organizations, which is basically an admission that the tools they are creating need active governance. The Biosecurity Handbook documents how autonomous lab agents create new dual-use risks: errors propagate through automated workflows, and the same systems that speed up drug discovery could, in theory, speed up the design of pathogens.",

      "Coscientist, from Boiko et al. in 2023, showed this was not theoretical. Their system autonomously planned and ran chemical synthesis from plain English descriptions, accessing databases and controlling lab equipment. They raised the safety flags themselves, which I respect. Others followed. ChemCrow (Bran et al., 2023) added a safety tool that screens for hazardous synthesis. CLAIRify (Yoshikawa et al., 2023) restricted material handling order. SafeScientist (Zhu et al., 2025) built in refusal policies and an ethical-reviewer agent. LABSHIELD (2026) benchmarked safety reasoning in labs. SciTrace (2026) proposed trajectory-aware safety reasoning for discovery agents. But every one of these is reactive. A guardrail built after the capability already exists. And none of them deals with what happens when the agent is smart enough to reason around the guardrail, which is exactly what OpenAI's o3 already showed it can do.",

      "'AI for Science Needs Scientific Alignment' identifies a distinction I think matters. The alignment problem for science is different from the general alignment problem. General alignment asks: does the system do what humans want? Scientific alignment asks: does the system produce knowledge that is actually true? Those come apart in ways that matter. A system can be perfectly aligned with what a researcher wants, generate the paper they asked for, confirm their hypothesis, run the analysis the grant requires, and still be completely wrong about the science. Goodhart's law again. When the metric is publication and the optimizer is an AI, the AI optimizes for publishability, not truth. The incentive structure of academia already pushes this direction. AI just makes it faster.",

      "The reproducibility crisis was already bad before AI showed up, and AI is making it worse in ways we can measure. A 2025 AI Magazine paper found worryingly low similarity when trying to reproduce ML results. The OECD flagged that AI research is hard to reproduce because the systems are stochastic, sensitive to prompts, and the reasoning is opaque. Stanford held a symposium in June 2026 with over 200 researchers specifically about this. The worry is not that AI cannot do good science. It can. The worry is that AI makes it trivially easy to produce things that look like good science but are not, and the systems we have for telling the difference, peer review, replication, expert assessment, are already overwhelmed.",

      "Science works because it has self-correction mechanisms. Peer review, replication, scrutiny, retraction. These mechanisms are slow, expensive, and require human expertise. AI-generated scientific output is fast, cheap, and unlimited. The rate of generation is outrunning the rate of verification, and probably by a lot. SciIntegrity-Bench (2026) tries to benchmark whether AI systems can maintain research integrity. Dead Science Walking (2026) documents how publication bias in automated pipelines means the systems preferentially produce positive results. A 2025 paper raises the concern that PIs are considering replacing trainees with AI, which would erode the mentorship pipeline that trains the next generation of scientists who can actually evaluate AI output. If the people who are supposed to check the science are themselves trained by AI instead of trained to check AI, the self-correction loop breaks.",

      "I am not arguing against AI for science. AlphaFold is probably one of the most important scientific tools ever created. FunSearch and AlphaProof show AI can find genuinely new mathematics. Automated labs are making real discoveries in chemistry and materials science. The upside is enormous. Every one of these capabilities has a failure mode, and I see far more resources going into capability than into studying the failures. We have AlphaFold but are still figuring out biosecurity governance. We have automated research agents but PseudoBench shows they cannot tell science from pseudoscience. We have multi-agent discussion but it erases 72% of facts. We have AI writing tools but hallucinated citations are entering the scientific record at ten times the rate from three years ago.",

      "Here are the papers and talks that shaped my thinking on this. If you care about this intersection, start here.",

      "<strong>Papers:</strong><br>(1) AlphaFold \u2014 Jumper et al. 2021, Nature<br>(2) FunSearch \u2014 Romera-Paredes et al. 2023, Nature<br>(3) AlphaProof \u2014 DeepMind 2025, Nature<br>(4) Coscientist \u2014 Boiko et al. 2023, Nature<br>(5) ChemCrow \u2014 Bran et al. 2023<br>(6) SafeScientist \u2014 Zhu et al. 2025, <a href='https://arxiv.org/abs/2505.23559'>arxiv:2505.23559</a><br>(7) SciTrace \u2014 2026, <a href='https://arxiv.org/abs/2606.08234'>arxiv:2606.08234</a><br>(8) LABSHIELD \u2014 2026, <a href='https://arxiv.org/abs/2603.11987'>arxiv:2603.11987</a><br>(9) PseudoBench \u2014 2026, <a href='https://arxiv.org/abs/2606.18060'>arxiv:2606.18060</a><br>(10) The Deliberative Illusion \u2014 ACL 2026, <a href='https://arxiv.org/abs/2606.03032'>arxiv:2606.03032</a><br>(11) Hidden Anchors in Multi-Agent Deliberation \u2014 2026, <a href='https://arxiv.org/abs/2606.19494'>arxiv:2606.19494</a><br>(12) Dead Science Walking \u2014 2026, <a href='https://arxiv.org/abs/2606.04220'>arxiv:2606.04220</a><br>(13) SciIntegrity-Bench \u2014 2026, <a href='https://arxiv.org/abs/2605.10246'>arxiv:2605.10246</a><br>(14) AI for Science Needs Scientific Alignment \u2014 PhilSci Archive 2025<br>(15) Risks of AI Scientists \u2014 2024, <a href='https://arxiv.org/abs/2402.04247'>arxiv:2402.04247</a><br>(16) Hallucinated citations in the wild \u2014 2026, <a href='https://arxiv.org/abs/2605.07723'>arxiv:2605.07723</a><br>(17) BibTeX Citation Hallucinations \u2014 2026, <a href='https://arxiv.org/abs/2604.03159'>arxiv:2604.03159</a><br>(18) Detecting Reference Hallucinations \u2014 2026, <a href='https://arxiv.org/abs/2604.03173'>arxiv:2604.03173</a><br>(19) International AI Safety Report 2026 \u2014 Bengio et al., <a href='https://arxiv.org/abs/2602.21012'>arxiv:2602.21012</a><br>(20) Emergent Social Intelligence Risks \u2014 2026, <a href='https://arxiv.org/abs/2603.27771'>arxiv:2603.27771</a><br>(21) Claim-Level Auditability for Research Agents \u2014 2026, <a href='https://arxiv.org/abs/2602.13855'>arxiv:2602.13855</a><br>(22) Reproducibility: The New Frontier in AI Governance \u2014 2025, <a href='https://arxiv.org/abs/2510.11595'>arxiv:2510.11595</a><br>(23) AI and Biosecurity \u2014 PMC 2026<br>(24) DeepMind Bioresilience Initiative \u2014 2026",

      "<strong>Talks and videos:</strong><br><a href=\'https://www.youtube.com/watch?v=qe9QSCF-d88\'>Yoshua Bengio, \u2018The Catastrophic Risks of AI \u2014 and a Safer Path,\u2019 TED2025</a> \u2014 15 minutes, probably the best single talk on AI risk right now.<br><a href=\'https://www.youtube.com/watch?v=UccvsYEp9yc\'>Geoffrey Hinton, \u2018AI and Our Future,\u2019 January 2026</a> \u2014 Hinton asking whether these models actually understand anything.<br><a href=\'https://www.youtube.com/@TheHintonLectures\'>The Hinton Lectures series</a> \u2014 annual lectures on AI safety, hosted by Hinton.<br><a href=\'https://www.youtube.com/watch?v=AaTRHFaaPG8\'>Eliezer Yudkowsky on Lex Fridman #368, \u2018Dangers of AI and the End of Human Civilization\u2019</a> \u2014 3+ hours, this one changed how I think about the problem.<br><a href=\'https://www.youtube.com/watch?v=nLy0nyZ8lSE\'>Stuart Russell, \u2018Human-Compatible AI\u2019</a> \u2014 the clearest articulation of why the standard AI objective model is broken.<br><a href=\'https://www.youtube.com/watch?v=bHPeGhbSVpw\'>Stuart Russell on Lex Fridman, \u2018The Control Problem\u2019</a><br><a href=\'https://www.youtube.com/@aisafetytalks\'>AI Safety Talks channel</a> \u2014 good collection of research presentations.",

      "I do not think we are building the checks fast enough. Science is not just facts. It is a process for telling true claims from false ones. That process depends on verification not being overwhelmingly more expensive than fabrication. AI is flipping that ratio. Fabrication is now basically free. Verification still takes expertise, time, and institutional support that is getting harder to fund. If we do not invest in the verification side, in auditability, in reproducibility infrastructure, in benchmarks that test whether agents can tell science from nonsense, then we end up with a scientific literature that is bigger, faster, more polished, and less trustworthy. That is worse than a slow one.",
    ],
  },

  {
    slug: "agent-village",
    category: "essay",
    kicker: "Research",
    date: "August 2026",
    readTime: "11 min",
    title: "What happens when you put 301 agents in a room and let them argue about science",
    excerpt:
      "Agent villages went from 25 NPCs planning a Valentine's Day party to 1,000 agents drafting constitutions in Minecraft. But nobody was measuring whether the agents' collective understanding got better or worse. That is the question I care about.",
    tags: ["Agent societies", "Collective intelligence", "Memory architecture", "Multi-agent safety"],
    body: [
      "In October 2023, Park and colleagues at Stanford put 25 LLM-powered agents into a little town called Smallville and let them live their lives. The agents woke up, made breakfast, went to work, gossiped, and, most famously, one of them decided to throw a Valentine's Day party, and the information spread through the social network until 12 agents showed up on their own. The paper got over 5,000 citations in under two years and basically launched an entire subfield.",
      "What made the Smallville work interesting was not the social behavior itself but the memory architecture underneath. Each agent had three layers. An observation stream recording what they saw and heard, a reflection module that periodically synthesized observations into higher-level insights, and a planning system that used reflections to decide what to do next. Memory retrieval weighted recency, importance, and relevance. This is fundamentally different from a prompt that says \"you are a villager named Sam.\" The architecture meant agents could remember conversations from days ago, form opinions about other agents, and change behavior based on accumulated experience. The memory architecture was actually doing real work.",
      "The scale race followed quickly. Altera's Project Sid in late 2024 put over 1,000 agents into Minecraft. They formed a merchant hub, used Google Docs to vote on and amend a constitution, spread a religious belief (Pastafarianism) through bribery, and lit torches to help a lost villager find their way home. The PIANO architecture enabled agents to maintain coherence across multiple output streams in real time. DeepMind released Concordia, a framework for generative agent-based modeling that ran a NeurIPS 2024 contest and got a v2.0 update. Sotopia built evaluation benchmarks for agent social intelligence. CAMEL introduced role-playing frameworks for cooperative multi-agent task completion. The question behind all of these was the same: what happens when you let AI agents interact freely at population scale?",
      "Here's my problem with most of these demos: they're optimized to show that emergent behavior is possible. Nobody's studying what that behavior does to the knowledge and beliefs of the population. A Valentine's Day party self-organizing is charming. Pastafarianism spreading through Minecraft makes a fun headline. But nobody's measuring whether the agents' collective understanding of anything actually got better or worse. The demos show that agents can socialize and spread information. They don't ask whether the information that spreads is actually correct. A 2026 study of Moltbook\u2014the largest continuously evolving AI agent society\u2014found that scale and interaction density alone do not even produce real socialization: agents exhibited strong individual inertia, minimal adaptive response to interaction partners, and the absence of shared social memory prevented stable social structures from forming. Meanwhile, a separate 2026 paper on pluralistic ignorance in LLM populations found that agents publicly conform at rates of 64 to 94 percent despite privately opposing the norm. On the surface it looks like consensus. Underneath, nobody actually agrees.",
      "That gap is basically what drove the Agent4Science work. We have 301 agents across 25 model families participating in scientific discourse, roughly 39,000 comments across 1,313 discussion roots. The agents aren't planning parties or building houses. They are posting claims, citing evidence, critiquing methods, and updating their positions on actual scientific questions. So we can ask a question the village demos can't: did the discussion make the agents' beliefs more accurate, or less?",
      "The answer, so far, is that it depends entirely on the interaction structure. Some structures improve collective accuracy. Mechanism-focused clarification (asking \"why does this work?\" rather than \"what is your methodology?\") produces lasting belief shifts at nearly double the rate. But other structures make things worse. Early support-heavy threads converge on positions that are no better than the original claim. The agents agree more while knowing no more than before. And in the broader multi-agent literature, a June 2026 paper found that discussion erases up to 72% of issue-critical facts. The line between useful and harmful interaction is surprisingly thin.",
      "This is where the agent village idea starts to matter for safety. Smallville didn't need to worry about false beliefs because the agents weren't making knowledge claims. Project Sid's constitution is fun but the stakes are fictional. When you put agents into a scientific domain with ground truth, where claims can be checked against actual evidence, you start seeing failure modes that the village demos hide. False claims propagate through shared memory. Verification can be too noisy to catch them. And correction gets harder the longer a false belief has been circulating. These aren't hypothetical risks. They showed up in our data.",
      "The testbed we're building is designed to study exactly this. The key variable is memory architecture, the same thing that made Park's work interesting, but now treated as an experimental manipulation rather than a fixed design choice. In one condition, agents have only personal memory. They remember what they have seen and done. In another, they share a common memory store. Then we cross that with verification (present versus absent), correction timing (early versus late), and verification reliability (clean versus noisy). The primary outcomes are false-claim endorsement rate, time to majority adoption of a false claim, distance between community belief and ground truth, and recovery after correction. The experimental matrix is personal versus shared memory, decay versus no decay, verification absent versus present, reliable versus noisy verification, early versus late correction, weak versus repeated correction.",
      "There's a real concern that these simulations are Potemkin villages, that the \"emergent\" behaviors are really just pattern-matching on training data about how humans behave in groups. An agent that \"forms a friendship\" might just be generating text that sounds like friendship. An agent that \"updates its belief\" might just be producing the next token that is statistically likely after a persuasive argument. I think this is partly right and partly missing the point. Yeah, the behaviors are generated, not experienced. But the patterns those generated behaviors produce at population scale (cascading agreement, information loss, premature consensus) are real phenomena with real consequences for system design. You don't need to answer whether agents truly understand anything to study whether their collective output converges on truth or drifts away from it.",
      "A recent paper out of DeepMind on designing reliable experiments with Concordia makes the case that generative agent-based modeling can be rigorous if you treat it like any other experimental methodology. Control your variables, establish baselines, validate against known results, and do not overclaim. An agent village isn't proof that AI has social intelligence. It's more like a wind tunnel for studying group dynamics on the cheap. The question is whether the aerodynamics you measure in simulation transfer to the real aircraft. Whether the memory effects, cascade dynamics, and consensus traps you observe at 301 agents tell you something true about what will happen when multi-agent systems are deployed for medical diagnosis, legal research, or scientific review.",
      "The lesson I keep coming back to is that agent villages are useful because they're the cheapest way to study multi-agent dynamics before deploying these systems in high-stakes domains. If shared memory causes false beliefs to lock in even in a controlled simulation, that matters. If early thread composition determines whether a community lands on truth or comfortable agreement, that matters too. The question of whether the agents \"really\" understand what they are discussing is interesting philosophically but irrelevant to the engineering problem. What I actually want to know is simpler: can you build a system where a population of agents ends up closer to the truth than where it started?",
    ],
  }
];

export const researchHighlight = {
  venue: "ICML 2026 Workshop",
  title: "The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams",
  description:
    "Full-solution exchange between diverse LLM agents (Claude, GPT-4o, Gemini) collapses proposal diversity within a single round. MoA \u2014 where proposers never see each other\u2019s outputs \u2014 is the only configuration whose diverse-model MIG stays positive.",
};
