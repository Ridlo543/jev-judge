import { describe, expect, it } from "bun:test";
import {
  comparePassages,
  decideChoice,
  findBest,
  rerankCandidates,
} from "../src/tools/research";

describe("Research domain tools", () => {
  it(
    "arbitrates technical candidate choices with decideChoice",
    async () => {
      const res = await decideChoice({
        decision: "Choose a database for high-throughput append-only financial ledger logging",
        candidates: [
          {
            id: "sqlite_in_memory",
            description: "In-memory SQLite database without persistence across server restarts.",
          },
          {
            id: "postgresql_partitioned",
            description: "PostgreSQL with time-partitioned tables, strict ACID transactions, and WAL replication.",
          },
        ],
        evidence: "Production financial system requires durable audit logs that survive node crashes.",
        priorities: "Durability and audit compliance are non-negotiable.",
        requirements: ["Survives crashes without data loss"],
      });

      expect(res.recommendation.selected).toBe("postgresql_partitioned");
      expect(res.recommendation.escaped).toBe(false);
      expect(res.recommendation.confidence).toBeGreaterThan(0.5);
      expect(res.checks).toHaveLength(2);
    },
    20_000,
  );

  it(
    "finds best semantic hit with findBest and reports exists_verdict",
    async () => {
      const res = await findBest({
        query: "Where is the authentication JWT token decoded and verified?",
        candidates: [
          { id: "database.ts", text: "Database connection pool and query builder helper." },
          { id: "auth.ts", text: "jwt.verify(token, secret) decodes payload and validates claims." },
          { id: "css.ts", text: "Tailwind CSS utility classes for responsive typography." },
        ],
        top_k: 2,
      });

      expect(res.exists_verdict).toBe("answered");
      expect(res.exists).toBeGreaterThan(0.6);
      expect(res.top).toHaveLength(2);
      expect(res.top[0].id).toBe("auth.ts");
    },
    20_000,
  );

  it(
    "reranks candidate list by relevance with rerankCandidates",
    async () => {
      const res = await rerankCandidates({
        query: "Find documentation about Docker container deployment",
        candidates: [
          { id: "c1", text: "Cooking recipe for chocolate chip cookies." },
          { id: "c2", text: "Docker Compose multi-stage build instructions for production containers." },
          { id: "c3", text: "Setting up a local Kubernetes cluster using minikube." },
        ],
      });

      expect(res.ranked).toHaveLength(3);
      expect(res.ranked[0].id).toBe("c2");
      expect(res.ranked[0].rank).toBe(1);
      expect(res.ranked[0].relevance).toBeGreaterThan(res.ranked[2].relevance);
    },
    20_000,
  );

  it(
    "compares two passages for contradiction or agreement with comparePassages",
    async () => {
      const res = await comparePassages({
        passage_a: "The API rate limit is strictly 100 requests per minute per IP address.",
        passage_b: "Clients can make at most 100 requests every minute before receiving HTTP 429.",
        aspects: ["rate_limit"],
      });

      expect(res.relation).toBe("same_fact");
      expect(res.confidence).toBeGreaterThan(0.5);
      expect(res.aspects?.rate_limit).toBeDefined();
      expect(res.aspects?.rate_limit.relation).toBe("same_fact");
    },
    20_000,
  );
});
