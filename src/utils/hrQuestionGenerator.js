/**
 * hrQuestionGenerator.js – Company-Standard 12-Question Generator for HR Round.
 *
 * Structure:
 *  - Stage 0: Mandatory Self Introduction & Background Pitch
 *  - Stages 1-7: 7 In-depth Technical Questions (Resume projects, architecture, trade-offs, company standard)
 *  - Stages 8-11: 4 Core Behavioral Questions (Evaluated strictly with the STAR method)
 */

export function generateHRQuestions(candidateData) {
  const company = candidateData?.targetCompany || 'MAANG';
  const role = candidateData?.parsedProfile?.roleTitle || 'Software Engineer';
  const projects = candidateData?.parsedProfile?.projects || [];
  const skills = candidateData?.parsedSkills?.length > 0
    ? candidateData.parsedSkills
    : ['Distributed Systems', 'Modern Web Frameworks', 'Databases', 'Cloud & APIs'];

  // Identify primary and secondary projects if present
  const leadProject = projects[0]?.name || 'your primary engineering project';
  const leadDesc = projects[0]?.description ? ` (${projects[0].description})` : '';
  const secondProject = projects[1]?.name || 'a secondary system or service you built';

  const questions = [
    // ── 0. Mandatory Self-Introduction ──
    {
      id: 0,
      phaseNumber: 1,
      type: 'intro',
      category: 'Self Introduction',
      company,
      badgeColor: 'indigo',
      title: 'Candidate Introduction & Technical Background',
      question: `Welcome to your HR & Technical Fit round for ${company}. Let's begin with your introduction: walk me through your background, your core technical strengths, and what you've built recently.`,
      evaluationGuide: 'Evaluates concise communication, technical identity, and clarity of narrative.',
      inactivityPrompt: "Take your time. Feel free to give a quick overview of your background, technical skills, and recent projects.",
    },

    // ── 1 to 7: Technical Questions (Resume, Projects & Company Standards) ──
    {
      id: 1,
      phaseNumber: 2,
      type: 'technical',
      category: 'Project Architecture',
      company,
      badgeColor: 'brand',
      title: `System Architecture: ${leadProject}`,
      question: `In your resume, you highlighted ${leadProject}${leadDesc}. Could you break down the high-level architecture of this system and explain the reasoning behind its component boundaries?`,
      evaluationGuide: 'Evaluates system modularity, design pattern selection, and architectural depth.',
      inactivityPrompt: `Whenever you're ready, feel free to walk me through the architecture and main components of ${leadProject}.`,
    },
    {
      id: 2,
      phaseNumber: 3,
      type: 'technical',
      category: 'Technical Trade-offs',
      company,
      badgeColor: 'brand',
      title: 'Architectural Decisions & Trade-Offs',
      question: `When building ${leadProject}, what was the most contentious architectural decision or technology choice you made? Why did you pick that approach over the alternatives?`,
      evaluationGuide: 'Evaluates engineering pragmatism, cost-benefit analysis, and avoiding dogmatism.',
      inactivityPrompt: "Take your time. Consider what technologies or trade-offs you evaluated when designing the system.",
    },
    {
      id: 3,
      phaseNumber: 4,
      type: 'technical',
      category: 'Performance & Bottlenecks',
      company,
      badgeColor: 'brand',
      title: 'Latency & Performance Optimization',
      question: `At ${company} scale, latency and resource utilization are paramount. Where was the primary performance bottleneck in your project, and what profiling or optimization techniques did you implement?`,
      evaluationGuide: 'Evaluates profiling methodologies, algorithmic complexity, database index/query tuning, and caching.',
      inactivityPrompt: "Feel free to share any bottleneck you tackled—such as slow queries, high memory usage, or rendering latency.",
    },
    {
      id: 4,
      phaseNumber: 5,
      type: 'technical',
      category: 'Scalability & Concurrency',
      company,
      badgeColor: 'brand',
      title: 'Scaling & High Concurrency',
      question: `If ${leadProject} experienced a sudden 50x spike in concurrent requests, what part of the infrastructure would fail first, and how would you re-architect it for high availability?`,
      evaluationGuide: 'Evaluates load balancing, horizontal vs vertical scaling, partitioning, and backpressure.',
      inactivityPrompt: "Think about rate limiting, asynchronous queues, caching, or read replicas under heavy traffic.",
    },
    {
      id: 5,
      phaseNumber: 6,
      type: 'technical',
      category: 'Production Outage & Debugging',
      company,
      badgeColor: 'brand',
      title: 'Root Cause Analysis & Outage Recovery',
      question: `Tell me about the hardest production bug or incident you encountered in ${leadProject || secondProject}. How did you diagnose the root cause, mitigate immediate damage, and prevent recurrence?`,
      evaluationGuide: 'Evaluates incident management, observability (logs/metrics/traces), and post-mortem hygiene.',
      inactivityPrompt: "Whenever you're ready, walk me through a challenging bug or outage and how you diagnosed it.",
    },
    {
      id: 6,
      phaseNumber: 7,
      type: 'technical',
      category: 'Testing & CI/CD Delivery',
      company,
      badgeColor: 'brand',
      title: 'Testing Strategy & Deployment Confidence',
      question: `How did you structure your testing pyramid and CI/CD automation to ensure zero-downtime deployments without regression?`,
      evaluationGuide: 'Evaluates unit/integration test coverage, canary/blue-green deployments, and test reliability.',
      inactivityPrompt: "Feel free to mention your unit, integration, or end-to-end testing practices and deployment pipelines.",
    },
    {
      id: 7,
      phaseNumber: 8,
      type: 'technical',
      category: 'Security & Edge Cases',
      company,
      badgeColor: 'brand',
      title: 'Security, Resiliency & Edge Cases',
      question: `How did you handle security threats (authentication, authorization, data validation) and catastrophic edge cases in your system?`,
      evaluationGuide: 'Evaluates defensive programming, principle of least privilege, input sanitization, and fallback states.',
      inactivityPrompt: "Take a moment to discuss authentication, role-based access, error boundaries, or rate limiting.",
    },

    // ── 8 to 11: Behavioral Questions (Evaluated Strictly with STAR) ──
    {
      id: 8,
      phaseNumber: 9,
      type: 'behavioral',
      category: 'Behavioral (STAR)',
      company,
      badgeColor: 'rose',
      title: 'Deadline Pressure & High-Stakes Prioritization',
      question: `Tell me about a time you had to deliver a critical milestone under an aggressive deadline with shifting requirements. Walk me through the Situation, Task, Action, and Result.`,
      evaluationGuide: 'STAR Method: Situation, Task, Action, Result. Evaluates composure under fire and scope management.',
      inactivityPrompt: "Take your time. Use the STAR method: describe the Situation, your specific Task, the Actions you took, and the final Result.",
    },
    {
      id: 9,
      phaseNumber: 10,
      type: 'behavioral',
      category: 'Behavioral (STAR)',
      company,
      badgeColor: 'rose',
      title: 'Technical Disagreement & Conflict Resolution',
      question: `Describe a situation where you had a strong technical disagreement with a senior engineer or tech lead on system architecture. How did you advocate for your point of view and what was the outcome?`,
      evaluationGuide: 'STAR Method: Evaluates emotional intelligence, data-driven persuasion, and "disagree and commit".',
      inactivityPrompt: "Recall a technical discussion or code review where opinions diverged, and how you worked together to find a solution.",
    },
    {
      id: 10,
      phaseNumber: 11,
      type: 'behavioral',
      category: 'Behavioral (STAR)',
      company,
      badgeColor: 'rose',
      title: 'Accountability, Failure & Learning',
      question: `Walk me through a time a technical decision or project you owned didn't go as expected or caused an issue. How did you take ownership and what did you learn?`,
      evaluationGuide: 'STAR Method: Evaluates extreme ownership, humility, self-awareness, and institutional learning.',
      inactivityPrompt: "Feel free to share an unexpected setback or mistake, how you took responsibility, and what you changed moving forward.",
    },
    {
      id: 11,
      phaseNumber: 12,
      type: 'behavioral',
      category: 'Behavioral (STAR)',
      company,
      badgeColor: 'rose',
      title: 'Cross-Functional Collaboration & Driving Alignment',
      question: `Describe a scenario where you had to work with non-technical stakeholders (Product Managers, Designers, Operations) to align on a complex project. How did you bridge the communication gap?`,
      evaluationGuide: 'STAR Method: Evaluates cross-functional empathy, stakeholder management, and translating technical complexity.',
      inactivityPrompt: "Think about a time you collaborated with product managers or designers to launch a feature.",
    },
  ];

  return questions;
}
