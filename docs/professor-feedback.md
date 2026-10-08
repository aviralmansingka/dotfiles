# Professor Feedback

Historical product feedback preserved from the local `professor_feedback.md`
scratch file during live-config housekeeping. These are requests to triage, not
new agent instructions or a record of implemented behavior.

## Notes

- remove btw. I don't want the extension and I want to remove everything from skills/prompts that reference it
- for professor skill especially the simple technical english guidance is important. Make sure it's reinforced in the
  skill to be 100%. Make sure it's also used for ask-user-question, quiz, explain, and every other extension
- professor can't keep asking questions. At some point, I need to actually acquire new knowledge.
- I want the lesson plan to include the mermaid on top
- having a historical record of the quiz questions is useful, but I don't really need it in chronological order. Having
  it be append-only at the bottom of the file would be better .
- The mermaid diagram generation is amazing. I'd like to update the system prompt to rely on the same mechanism here
- I don't want the timestamp in the title of the quiz. I want each quiz to be generated with it's own title. keep the
  title short and sweet. Focus on the teaching goal or content
- I want quiz/explain to have a title containing what node they are testing from. When I open the lesson file, I want to
  be routed to that specific node only
  - I actually like the md-log approach of keeping only the node open that I need. It would be nice if instead of a
    file, we would keep an active in-memory buffer open that would only contain the node relevant to the current
    question on the side.
