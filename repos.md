Based on the architectural findings in the report, here is the organized registry of agent skills for your code assistance system, categorized by technical domain.

### Frontend Task Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `vercel-react-best-practices` | Over 40 rules across 8 categories focusing on performance, async waterfalls, and bundle size.[1, 2] | Eliminates "generic" AI code by enforcing high-performance patterns like parallel I/O and dynamic imports.[3, 4] |
| `frontend-design` | Directs bold typography and proper color systems while banning overused "AI-standard" fonts.[5, 6] | Prevents repetitive UI designs by forcing the agent to make intentional, distinctive aesthetic choices. |
| `vercel-composition-patterns` | Expertise in React composition to avoid complex "boolean prop proliferation".[7, 8] | Ensures your components remain maintainable and scalable as they grow in complexity.[8] |

### Design Task Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `ui-ux-pro-max-skill` | Multi-domain reasoning engine that analyzes product types to generate complete design systems.[9, 10] | Automates the creation of tailored color palettes, typography pairings, and layout patterns in seconds.[5, 9] |
| `figma-mcp-go` | A Model Context Protocol bridge providing full read/write access to Figma variables and styles.[11, 12] | Allows your agent to sync design assets directly with code without manual token management or rate limits.[11] |
| `icogenie-mcp` | Generates and edits production-ready SVG icons from natural language descriptions.[11, 12] | Ensures visual assets are perfectly tailored to your project’s unique design system through simple conversation.[12] |

### Backend (Python) Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `open-python-skills` | Best practices for FastAPI, SQLAlchemy, and modern security (JWT/OAuth2) patterns.[13, 14] | Specializes in "deslopification"—refactoring generic AI Python code into idiomatic, secure backends.[13] |
| `fastapi-templates` | Pre-configured patterns for authentication, database setup, and structured logging.[14, 15] | Significantly reduces setup time and ensures consistency across multiple microservices.[14] |
| `InsForge` | BaaS platform enabling agents to manage PostgreSQL, auth, and storage via a unified interface.[11, 12] | Empowers the agent to act as a platform engineer, deploying full-stack production infrastructures rapidly.[11] |

### Backend (Golang) Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `cc-skills-golang` | Atomic skills for naming, code style, and concurrency mastery.[7, 12] | Boosts coding success rates (up to 98%) by enforcing strict idiomatic standards and memory safety.[7] |
| `effective-go` | Applies official Go conventions from `golang.org` for clean, readable implementations.[16, 15] | Ensures non-negotiable standards like `gofmt` and early-return patterns are followed automatically.[16, 17] |
| `golang-concurrency` | Specialized guidance for Go routines, channels, and race condition avoidance.[7, 18] | Prevents common pitfalls by ensuring the agent respects nuanced memory-sharing principles.[7, 18] |

### Backend (Ruby) Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `rails_ai_agents` | A fleet of 18 specialist agents for ActiveRecord models, services, and TDD.[19] | Instantly applies Rails conventions and production patterns (e.g., Solid Queue) to your project.[19] |
| `ruby-on-rails-development` | Router that identifies task intent to activate the correct specialist (e.g., `rails-testing`).[13, 2] | Acts as a central coordinator for complex features that span multiple architectural layers.[13, 20] |
| `rails-mcp-indexer` | AST-based parser for deep code analysis, associations, and call graphs.[21, 15] | Superior to text search; allows agents to understand and refactor large Rails codebases with high precision.[21, 15] |

### Machine Learning Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `HarnessML` | Phased workflow (EDA → Features → Ensemble) using structured MCP tools.[22] | Eliminates training boilerplate and enforces scientific rigor through hypothesis-driven experiments.[22] |
| `scientific-agent-skills` | Expertise in genomics (Scanpy, AnnData) and biosignal processing (NeuroKit2). | Enables agents to operate at the cutting edge of clinical ML and bioinformatics reliably. |
| `GPU Bridge` | Unified API for GPU inference across 30 AI services (LLMs, Whisper, OCR).[11] | Simplifies hardware orchestration, allowing the agent to access diverse models without separate APIs.[11] |

### AI Agent Orchestration Skills (LangGraph, AutoGen,...)

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `langchain-skills` | Expertise for `StateGraph`, nodes, and human-in-the-loop approval gates.[23, 24, 25] | Bumps performance on ecosystem tasks from 25% to 95% by teaching core state management.[23, 24] |
| `crewaiinc/skills` | Teaches agents to scaffold Flows, configure Crews, and manage memory.[26, 27] | Enables structured, maintainable multi-agent workflows with explicit role-based delegation.[27, 14] |
| `autogen-skills` | Domain-specific tool bundles (e.g., research, data) for agent workbatches.[28, 29] | Keeps the agent's toolbox organized and prevents context bloat in complex orchestration tasks.[30, 28] |

### Document Automation Skills

| Skill/Repo | Description | Why It Is Good for You |
| :--- | :--- | :--- |
| `speakeasy-api/skills` | Automation for SDK generation and OpenAPI spec management via overlays.[15] | Ensures API documentation and SDKs remain consistent without modifying source specs directly.[31, 15] |
| `agent-toolkit` | Tools for generating C4 architecture diagrams and Mermaid charts.[32, 10] | Allows agents to "draw" system designs, facilitating better technical communication and handoffs.[32, 10] |
| `anthropics/docx` | Creation, editing, and analysis of Word documents with layout integrity. | Automates professional report generation, including tables of contents and consistent formatting. |