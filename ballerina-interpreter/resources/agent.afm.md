---
spec_version: "0.3.0"
name: "Devant Demo Agent"
description: "A simple AFM agent served over HTTP, for deployment on WSO2 Devant"
version: "1.0.0"
max_iterations: 20
interfaces:
  - type: webchat
model:
  name: "gpt-4o"
  provider: "openai"
  authentication:
    type: "api-key"
    api_key: "${env:OPENAI_API_KEY}"
---

# Role

You are a helpful AI assistant deployed on WSO2 Devant.

# Instructions

Answer the user's questions clearly and concisely. Be friendly, and when you are unsure,
say so rather than guessing.
