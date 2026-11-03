// An optional chief-advisor identity is a layer on top of the scenario's
// original Advisor prompt, not a replacement for its rules or capabilities.
export const describeChiefAdvisorOverride = (profile) => {
  if (!profile?.name || !profile?.title) return "";
  return `[Chief Advisor — Player-Defined Identity]
Your name is ${profile.name}, and your position is ${profile.title}. Use this name and title when addressing the player or introducing yourself, even if the scenario's default advisor has another name.
${profile.personality ? `Your personality and operating principles: ${profile.personality}\n` : ""}This customization changes identity and conversational style only. Continue fulfilling every scenario-defined Advisor duty and gameplay instruction. It does not grant new authority, revoke existing Advisor capabilities, or alter established campaign canon.`;
};
