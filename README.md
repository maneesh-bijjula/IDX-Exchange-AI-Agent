# IDX Exchange AI Agent

Production-style multi-agent real estate assistant built with OpenClaw, OpenAI, MySQL MLS data, semantic search, RAG, WhatsApp integration, and human-in-the-loop safety workflows.

## Project Objective

The goal of this project is to build a multi-agent AI assistant for real estate search and market intelligence. The assistant will allow users to search active MLS listings, ask market questions, receive property recommendations, and interact through WhatsApp using an OpenClaw-based agent runtime.

## Week 1: Architecture Fundamentals

This week focuses on understanding the core OpenClaw architecture and documenting how user messages flow through the system.

### Core Components

- **WhatsApp Channel:** Primary user-facing communication layer.
- **OpenClaw Runtime:** Coordinates messages, sessions, tools, and agent responses.
- **Skill Router:** Routes user requests to the correct capability such as property search, market analytics, RAG, or recommendations.
- **Session Memory:** Maintains conversation context for follow-up questions and multi-turn searches.
- **Tool Layer:** Executes structured actions such as MySQL queries, embedding search, and email drafting.
- **MySQL Database:** Stores active listings and sold transaction data.
- **OpenAI Models:** Power natural language understanding, response generation, embeddings, and RAG workflows.

## Architecture Flow

```mermaid
flowchart TD
    A[User on WhatsApp] --> B[OpenClaw WhatsApp Channel]
    B --> C[OpenClaw Runtime]
    C --> D[Session Memory]
    C --> E[Skill Router]

    E --> F[Property Search Agent]
    E --> G[Market Analytics Agent]
    E --> H[Recommendation Agent]
    E --> I[RAG Knowledge Agent]
    E --> J[Email Draft Agent]

    F --> K[MySQL: rets_property]
    G --> L[MySQL: california_sold]
    H --> K
    H --> L
    I --> M[Indexed Docs and MLS Field Definitions]
    J --> N[Human Approval Gate]

    K --> O[Formatted Agent Response]
    L --> O
    M --> O
    N --> O

    O --> C
    C --> B
    B --> A
