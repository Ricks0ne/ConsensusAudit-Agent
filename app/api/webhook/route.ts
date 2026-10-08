import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const eventType = req.headers.get('x-github-event');

    // We only care about Pull Request events
    if (eventType !== 'pull_request' || (payload.action !== 'opened' && payload.action !== 'synchronize')) {
      return NextResponse.json({ message: "Ignored event type" }, { status: 200 });
    }

    const prUrl = payload.pull_request.html_url;
    const diffUrl = payload.pull_request.diff_url;
    const repoFullName = payload.repository.full_name;
    const commitSha = payload.pull_request.head.sha;

    console.log(`Intercepted PR from ${repoFullName}. Fetching diff...`);

    // 1. Fetch the actual code changes (the diff)
    const diffResponse = await fetch(diffUrl);
    const diffText = await diffResponse.text();

    // 2. Run the AI Red/Blue Team Consensus (Using the same prompt from our UI)
    const prompt = `
    You are a dual-agent simulation environment.
    TARGET PULL REQUEST DIFF:
    ${diffText}
    
    STEP 1 (RED TEAM): Act as an attacker. Write an exploit vector for the changes.
    STEP 2 (BLUE TEAM): Evaluate the exploit vector for mathematical viability.
    
    Return ONLY a strict JSON object: {"status": "APPROVED" | "REJECTED", "critical_count": number, "high_count": number, "findings": [{"type": "string", "severity": "Critical", "summary": "string"}]}
    `;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
        })
    });

    const aiData = await geminiRes.json();
    const verdict = JSON.parse(aiData.candidates[0].content.parts[0].text);

    // 3. The Gatekeeper: Update GitHub Status to Block or Allow the Merge
    const githubToken = process.env.GITHUB_BOT_TOKEN; 
    
    if (githubToken) {
        const state = verdict.status === "REJECTED" ? "failure" : "success";
        const description = verdict.status === "REJECTED" 
            ? `Blocked: Found ${verdict.critical_count} critical flaws.` 
            : "Passed: Multi-agent consensus verified.";

        await fetch(`https://api.github.com/repos/${repoFullName}/statuses/${commitSha}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                state: state,
                target_url: "https://consensus-audit.vercel.app", // Link back to our dashboard
                description: description,
                context: "GenLayer ConsensusAudit"
            })
        });
    }

    return NextResponse.json({ message: "PR audited and status updated", verdict });

  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}