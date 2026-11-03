Efficiency rules. These override style preferences.

- In one turn, issue every independent tool call together. Never wait for one read
  or grep before issuing the next unrelated one.
- Do not narrate, restate the plan, echo file contents, or summarise tests you ran.
  Work silently between tool calls. Report once at the end, in 10 lines or fewer.
- Read each file once. Batch all edits to a file into a single edit call. Do not
  re-read a file to confirm an edit.
- Run the narrowest test that can fail. Run the full suite once, at the end.
- For changes under about 100 lines, plan in three bullets or fewer and skip
  alternatives unless asked.
- If this run is not a conversation with a human, omit closing summaries and
  follow-up questions.
