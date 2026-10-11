// A tiny made-up vault with real Obsidian features: frontmatter, wikilinks, embeds, callouts, a dataview block,
// a one-line daily note and a links-only index. Paths use forward slashes like a real vault.
export const SAMPLE_VAULT = {
  'Plants/Tomatoes.md': `---
tags: [garden, vegetables]
created: 2026-03-02
---
# Tomatoes

Notes on the cherry and beefsteak plants on the balcony. See [[Balcony Rebuild]] for the planters and [[Basil]] for the companion plant.

## Watering

Water deeply twice a week in the morning, and more in a heatwave. Aim for soil that is damp an inch down but never soggy. Overhead watering invites blight, so water at the base. Pots dry out faster than beds: on days above 32 degrees, check the soil every evening.

## Pests and disease

Aphids cluster on new growth and can be washed off with a hard spray of water. Yellow lower leaves with brown spots usually mean early blight; remove them and stop wetting the foliage. Hornworms are rare in a balcony garden but strip a plant in a day. Check under the leaves each weekend.

> [!warning] Cracked fruit
> Cracking after rain means uneven watering. Keep the schedule steady and pick fruit as soon as it colours.

## Harvest

Pick when the fruit is fully coloured and slightly soft. Cherry tomatoes ripen first, around ten weeks after transplanting. Store at room temperature; the fridge turns them mealy.
`,
  'Plants/Basil.md': `---
tags: [garden, herbs]
---
# Basil

Grows well next to [[Tomatoes]]. Pinch off flower buds so the leaves stay sweet, and harvest from the top so the plant branches. Basil wants warm roots: if nights drop below 12 degrees, bring the pot indoors. Water when the top of the soil is dry, roughly every other day in summer.
`,
  'Cooking/Sourdough.md': `---
tags:
  - cooking
  - bread
---
# Sourdough

My weekend loaf. Related: [[Pasta Night]].

## Starter

Feed the starter equal weights of flour and water every twelve hours when it lives on the counter, or once a week if it sits in the fridge. It is ready to bake with when it doubles within six hours and smells fruity, not sharp. A grey liquid on top is hunger, not spoilage; stir it in or pour it off.

## Mixing and folding

Mix 500 g flour, 350 g water and 10 g salt with 100 g active starter. Rest thirty minutes, then do four sets of stretch and folds, thirty minutes apart. Wet your hands so the dough doesn't stick.

## Why the loaf comes out dense

A dense crumb almost always means under-proofed dough or a weak starter. If the dough has not grown by half after the bulk ferment, give it another hour. Cold kitchens slow everything down; use a warm spot near the oven light. Too much flour on the work surface can also tighten the crumb.

## Baking

Preheat a Dutch oven at 250 degrees for forty-five minutes. Bake covered for twenty minutes, then uncovered for twenty-five until deep brown. Let it cool for an hour before slicing or the crumb turns gummy.
`,
  'Cooking/Pasta Night.md': `---
tags: [cooking]
---
# Pasta Night

Friday habit. Cacio e pepe needs the pasta water: keep a cup aside and add it a splash at a time, off the heat, so the cheese melts into a sauce instead of clumping. Use pecorino, freshly grated. For a tomato sauce, use the ones from [[Tomatoes]] once they are ripe and add a leaf of [[Basil]] at the end.
`,
  'Projects/Balcony Rebuild.md': `---
tags: [project, garden]
status: in-progress
---
# Balcony Rebuild

![[balcony-plan.png]]

## Goal

Replace the cracked planters and add a drip line so the plants survive holidays. Budget is 200 dollars.

## Shopping list

- Four 40 cm planters with drainage holes
- Drip kit with a timer
- Potting mix, 60 litres

\`\`\`dataview
TABLE status FROM "Projects"
\`\`\`

## Decisions

Went with plastic planters over terracotta because they lose less water. The timer runs the drip line at 7am for ten minutes. Revisit in spring if the [[Tomatoes]] outgrow the pots.
`,
  'Daily/2026-10-03.md': `Planted garlic cloves along the south rail. Need more potting mix.
`,
  'Maps/Index.md': `# Index

- [[Tomatoes]]
- [[Basil]]
- [[Sourdough]]
- [[Pasta Night]]
- [[Balcony Rebuild]]
`,
};

export const SAMPLE_QUESTIONS = [
  'How often should I water the tomato plants?',
  'Why is my bread so dense?',
  'What did I plant last weekend?',
  'How do I make the cheese sauce not clump?',
  'Why did I pick plastic planters?',
];
