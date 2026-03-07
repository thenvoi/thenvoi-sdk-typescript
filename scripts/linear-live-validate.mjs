#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnvLocal();

const token = process.env.LINEAR_ACCESS_TOKEN;
const teamId = process.env.LINEAR_TEAM_ID ?? "2c36f836-9952-4e4f-b661-752a266e304c";
if (!token) {
  console.error("Missing LINEAR_ACCESS_TOKEN.");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const issueData = await gql(
  `mutation($input: IssueCreateInput!){
    issueCreate(input:$input){
      success
      issue { id identifier url }
    }
  }`,
  {
    input: {
      teamId,
      title: `Linear bridge live validation ${new Date().toISOString()}`,
      description: "Automated validation run from thenvoi-sdk-typescript.",
    },
  },
);

const issue = issueData.issueCreate.issue;
const sessionData = await gql(
  `mutation($input: AgentSessionCreateOnIssue!){
    agentSessionCreateOnIssue(input:$input){
      success
      agentSession { id status }
    }
  }`,
  {
    input: { issueId: issue.id },
  },
);

const sessionId = sessionData.agentSessionCreateOnIssue.agentSession.id;
console.log(`Created ${issue.identifier} (${issue.url})`);
console.log(`Created session ${sessionId}`);

const deadline = Date.now() + 90_000;
let sawThought = false;
let sawBridgeError = false;
let sawCompletion = false;
let lastStatus = "unknown";
let responseBodies = [];
let errorBodies = [];

while (Date.now() < deadline) {
  const data = await gql(
    `query($id:String!){
      agentSession(id:$id){
        status
        activities {
          nodes {
            createdAt
            content {
              __typename
              ... on AgentActivityThoughtContent { body }
              ... on AgentActivityErrorContent { body }
              ... on AgentActivityResponseContent { body }
              ... on AgentActivityElicitationContent { body }
            }
          }
        }
      }
    }`,
    { id: sessionId },
  );

  const session = data.agentSession;
  lastStatus = session.status;
  const activities = session.activities.nodes;
  sawThought = activities.some(
    (node) => node.content.__typename === "AgentActivityThoughtContent",
  );
  responseBodies = activities
    .filter((node) => node.content.__typename === "AgentActivityResponseContent" && typeof node.content.body === "string")
    .map((node) => node.content.body);
  errorBodies = activities
    .filter((node) => node.content.__typename === "AgentActivityErrorContent" && typeof node.content.body === "string")
    .map((node) => node.content.body);

  sawBridgeError = errorBodies.some((body) => body.includes("Bridge error:"));
  sawCompletion = session.status === "complete" && responseBodies.length > 0;

  if (sawThought && sawCompletion && !sawBridgeError) {
    console.log("Validation passed: session completed with response activity and no bridge error detected.");
    console.log("Latest response:");
    console.log(responseBodies[0]);
    process.exit(0);
  }

  await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
}

console.error("Validation failed: timeout waiting for completed healthy session activity.");
console.error(`status=${lastStatus} sawThought=${sawThought} sawCompletion=${sawCompletion} sawBridgeError=${sawBridgeError}`);
if (errorBodies.length > 0) {
  console.error("Errors:");
  for (const body of errorBodies) {
    console.error(`- ${body}`);
  }
}
process.exit(1);
