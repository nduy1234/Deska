# Deska demo video script (target 2:45, hard cap 3:00)

Capture on Quest 3 with hand tracking, seated, using the casting or recording
built into Quest. Before recording, load the page with `?reset` so the desk
starts fresh. Use `?day=1` for the "next day" scene. Voice-over lines are in
quotes. Keep the hands in frame and move slowly: hand tracking reads best at
half speed.

| Time | Shot | What happens | Voice-over / on-screen |
|---|---|---|---|
| 0:00–0:10 | **Hook.** Close on the hands. | One continuous take: pinch a cube from the tray, squeeze it, and it snaps into an hourglass (glow, chime, label). Flip it; the ring appears and the countdown starts. | "This cube is now my focus timer. I made it with my hands." |
| 0:10–0:18 | Wide, seated view of the desk | Show the whole desk: tray, jar, lever, plant, orb. Hold both palms up and the desk slides to you. | "Deska is a desk for your hands. No controllers, no menus. Everything is within reach." |
| 0:18–0:50 | **Sculpt** | Pull a cylinder, pinch both ends and stretch it tall; it locks as a lever. Pull another cylinder and squeeze it; the "almost a…" hint shows, then it locks. | "Shapes are a language: stretch it tall and it's a lever, pinch the waist and it's an hourglass." |
| 0:50–1:30 | **Tools work** | Jar: peel red, amber and green notes off the pad and drop them in, then pinch-tap and they sort. Lever: pull it and the morning routine plays ("Good morning", "Water · stretch · breathe", warm-up timer). | "Every object is a real tool, with sound and light for every touch, because your hands don't get haptics." |
| 1:30–2:15 | **Agent creates the dial** | Poke the orb and say "make a dial that sets my focus level". The orb shows *Thinking… → Testing it…*. A blue ghost dial appears and runs its own test: turn, the room dims, "Focus 66%", then "✓ 6/6 tested · pinch to keep". Pinch the ghost; it becomes real. Turn it and the room dims. | "Deska's agent builds tools from safe blocks, tests them in a sandbox, and shows you before you keep them. It never runs model code." |
| 2:15–2:25 | **Take it away** | (Optional cut) Airplane mode, poke the orb, intent cards appear, pick one, and a tool still arrives. | "No network? It still works. The AI is an accelerator, not the product." |
| 2:25–2:45 | **Next day** | Reload with `?day=1`: the desk comes back as you left it, the timer still running, the plant grows a leaf ("2-day streak"), and a gift box sits on the desk. Pinch it open: "New clay: cone". | "Your desk remembers, and it grows every day you come back." |
| 2:45–2:55 | End card | Desk at rest with a warm light. | **Deska.** Pinch clay into tools that work. *(URL)* |

## Shot checklist

- [ ] Clean `?reset` run recorded for 0:00–1:30 (onboarding prompts are fine to show)
- [ ] Agent run with a real LLM key configured (`LLM_API_KEY` on Vercel)
- [ ] Airplane-mode cut (optional)
- [ ] `?day=1` reload for the next-day scene
- [ ] Captions burned in (judges often watch muted)
