// Easter egg: April Fools 2026 — David Attenborough Nature Documentary theme.

import { EventFacts, fmtDuration, Mood, pick, short } from './helpers';

export function attenboroughSummary(f: EventFacts, mood: Mood): string {
  const lines: string[] = [];

  if (mood === 'error') {
    lines.push(
      pick([
        'In the harsh environment of the production cluster, not every request survives to see a 200 OK. This is one such tragic tale.',
        'What we are about to witness is a stark reminder of the brutality of distributed computing.',
        'Life in the cluster is unforgiving. And today, we observe a creature that did not survive the journey.',
        'In the wild expanses of the data center, failure is not the exception -- it is the rule. Today we see this firsthand.',
        'The production environment is a hostile place. Not all who enter these service meshes return.',
        'Observe now a scene that would make even the most hardened SRE look away. Nature, in all her cruelty.',
        'Across the tundra of the server rack, a distress signal echoes. Something has gone terribly wrong.',
        'Here we witness one of the harshest realities of the digital ecosystem. Not every process gets to complete.',
      ]),
    );
  } else if (mood === 'warn') {
    lines.push(
      pick([
        'Here, we observe the early warning signs of distress in the cluster ecosystem. A seasoned observer would know to pay close attention.',
        'The system is showing signs of strain. Like a herd sensing a distant predator, the warnings are subtle but unmistakable.',
        'Notice the subtle change in behavior. The metrics are elevated, the latency slightly higher. The experienced naturalist recognizes these signs immediately.',
        'There is tension in the air. The system is not failing -- not yet -- but one can sense the approaching storm.',
        'Like a reef ecosystem before a bleaching event, the early indicators are there for those trained to see them.',
        'The experienced observer will note the elevated stress hormones -- er, warning logs. A sign that all is not well in the colony.',
      ]),
    );
  } else {
    lines.push(
      pick([
        'And here, in the vast savanna of the distributed system, we observe a remarkable creature going about its daily routine.',
        'Deep within the cluster, a fascinating interaction is about to unfold. Let us observe... quietly.',
        'What we are about to witness is one of the most extraordinary phenomena in modern computing. The humble request, in its natural habitat.',
        'In the great migration of packets across the network, every journey tells a story. This one is no exception.',
        "Shh. If we remain very still, we can observe one of nature's most elegant processes: a service-to-service interaction in the wild.",
        'Welcome to the cluster. Population: thousands of containers, each one a world unto itself. Let us peek inside.',
        'Nestled among the nodes of a bustling Kubernetes cluster, a quiet miracle of engineering unfolds.',
        'Today we venture into one of the most biodiverse regions of the modern internet: the microservice archipelago.',
        'Here, at the edge of the load balancer, where the wild requests first make landfall, we observe a most peculiar specimen.',
        'In the coral reef of the container orchestrator, countless tiny services go about their business. Let us observe one now.',
        'At first light in the data center, the cluster awakens. Pods stretch, health checks pass, and the first requests of the day begin their migration.',
        'Few have had the privilege of observing a distributed system this closely. What a time to be alive.',
      ]),
    );
  }

  if (f.service) {
    const lang = f.sdkLanguage
      ? ` Its DNA is written in ${f.sdkLanguage} -- a fascinating dialect of the programming kingdom.`
      : '';
    const deploy = f.k8sDeployment
      ? ` It belongs to the "${f.k8sDeployment}" herd.`
      : '';
    lines.push(
      pick([
        `The ${f.service} service${f.serviceVersion ? `, generation ${f.serviceVersion},` : ''} stirs to life. It has been waiting patiently for precisely this moment.${lang}`,
        `Here we see ${f.service}${f.serviceVersion ? ` (${f.serviceVersion})` : ''} -- a remarkable specimen. It processes thousands of requests daily, yet each one receives individual attention.${deploy}`,
        `${f.service}${f.serviceVersion ? `, variant ${f.serviceVersion},` : ''} emerges from its container. A solitary creature, yet vital to the health of the entire ecosystem.${lang}`,
        `The ${f.service} species${f.serviceVersion ? `, generation ${f.serviceVersion},` : ''} is perfectly adapted to its niche. Evolution -- or rather, continuous deployment -- has honed it for this precise role.${deploy}`,
        `Observe the ${f.service}${f.serviceVersion ? ` (${f.serviceVersion})` : ''} -- a keystone species in this particular microservice biome. Remove it, and the entire food chain collapses.${lang}`,
        `${f.service}${f.serviceVersion ? `, build ${f.serviceVersion},` : ''} awakens from its idle state. Like a bear emerging from hibernation, it is hungry for requests.${deploy}`,
        `And there it is -- ${f.service}${f.serviceVersion ? `, now in its ${f.serviceVersion} iteration` : ''}. Each version a small adaptation. Each deployment, a leap of faith.${lang}`,
      ]),
    );
  }

  if (f.httpMethod && f.httpUrl) {
    lines.push(
      pick([
        `A ${f.httpMethod} request approaches ${short(f.httpUrl, 50)} -- cautiously, as if sensing danger. In the wild, only the fastest requests survive to completion.`,
        `Watch as it initiates a ${f.httpMethod} to ${short(f.httpUrl, 50)}. A ritual as old as HTTP itself, performed billions of times daily across the planet.`,
        `A ${f.httpMethod} request sets forth toward ${short(f.httpUrl, 50)}, navigating the treacherous waters of the network. Remarkable.`,
      ]),
    );
  } else if (f.dbSystem) {
    lines.push(
      pick([
        `It reaches out to ${f.dbSystem} -- the ancient oracle of the ecosystem. ${f.dbStatement ? `"${short(f.dbStatement, 50)}" it whispers.` : 'Every query is a prayer.'} The database considers this... and responds.`,
        `Now it approaches the ${f.dbSystem} watering hole. ${f.dbStatement ? `"${short(f.dbStatement, 50)}" -- ` : ''}All creatures in this ecosystem must drink from the database eventually.`,
        `It ventures to the ${f.dbSystem} feeding grounds. ${f.dbStatement ? `The query "${short(f.dbStatement, 50)}" is offered. ` : ''}A symbiotic relationship, millions of years -- er, commits -- in the making.`,
      ]),
    );
  } else if (f.rpcService && f.rpcMethod) {
    lines.push(
      pick([
        `It performs an intricate signaling dance to ${f.rpcService}.${f.rpcMethod}. In the microservice kingdom, cooperation between species is essential for survival.`,
        `Watch now as it performs its mating call -- a gRPC invocation to ${f.rpcService}.${f.rpcMethod}. The ritual is precise, protobuf-encoded, and quite beautiful in its own way.`,
        `An intricate chemical signal -- or rather, an RPC -- is exchanged with ${f.rpcService}.${f.rpcMethod}. Communication across service boundaries. Truly one of nature's marvels.`,
      ]),
    );
  } else if (f.messagingSystem) {
    lines.push(
      pick([
        `A message is released into ${f.messagingSystem}${f.messagingDestination ? `, destination "${f.messagingDestination}"` : ''}. Like a seed carried by the wind, it may take root -- or it may be lost to the void forever.`,
        `It deposits a message in ${f.messagingSystem}${f.messagingDestination ? `, topic "${f.messagingDestination}"` : ''}. An asynchronous act of faith, not unlike a salmon laying eggs and swimming on.`,
        `A pheromone -- or rather a message -- is released into ${f.messagingSystem}${f.messagingDestination ? `, channel "${f.messagingDestination}"` : ''}. The colony will know what to do with it.`,
      ]),
    );
  } else if (f.body) {
    lines.push(
      pick([
        `It communicates: "${short(f.body, 60)}". A simple signal, yet crucial for the health of the colony.`,
        `The message it carries: "${short(f.body, 60)}". In the language of the cluster, these words have profound meaning.`,
        `Listen -- "${short(f.body, 60)}". A vocalization that, to the untrained ear, seems unremarkable. But to the colony, it is vital intelligence.`,
      ]),
    );
  }

  if (f.durationMs != null) {
    if (f.durationMs > 60_000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. Extraordinary. This request has been alive longer than some mayflies. One can only admire its determination.`,
          `${fmtDuration(f.durationMs)}. An astonishing display of endurance. The giant tortoise of the API world, plodding ever onward.`,
          `${fmtDuration(f.durationMs)}. One begins to wonder if it has simply decided to stay. Some requests, like hermit crabs, find a timeout and make it home.`,
        ]),
      );
    else if (f.durationMs > 5000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. A remarkable endurance display. The three-toed sloth of the API kingdom, yet it perseveres.`,
          `${fmtDuration(f.durationMs)}. In internet years, that's a lifetime. Yet the request carries on, driven by some primal instinct to complete.`,
          `${fmtDuration(f.durationMs)}. The elephant of microservice calls -- slow, deliberate, but with a certain grandeur to its pace.`,
        ]),
      );
    else if (f.durationMs > 100)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. A respectable pace. Neither the cheetah nor the tortoise -- the steady gazelle of microservice calls.`,
          `${fmtDuration(f.durationMs)}. A perfectly adequate speed. The wildebeest of latency -- unremarkable, but reliable.`,
          `${fmtDuration(f.durationMs)}. A moderate cruising speed. One might say the golden retriever of response times: enthusiastic, if not the fastest.`,
        ]),
      );
    else if (f.durationMs > 0)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)} -- extraordinarily swift. The peregrine falcon of API calls, diving at breathtaking speed.`,
          `${fmtDuration(f.durationMs)}. Blink and you'll miss it. The hummingbird of the request kingdom, wings beating faster than the eye can follow.`,
          `${fmtDuration(f.durationMs)}. Astonishing velocity. The cheetah would be envious. The mantis shrimp would applaud.`,
        ]),
      );
  }

  if (f.httpStatus) {
    if (f.httpStatus >= 500)
      lines.push(
        pick([
          `But nature is cruel. A ${f.httpStatus} response. The request collapses mid-stride, its journey cut tragically short. Only the strong survive in production.`,
          `A ${f.httpStatus}. The request has fallen. In the great web of life, not every creature reaches its destination. A moment of silence.`,
          `${f.httpStatus}. The server, overwhelmed, lashes out. The request never stood a chance. Such is the brutality of production.`,
        ]),
      );
    else if (f.httpStatus >= 400)
      lines.push(
        pick([
          `A ${f.httpStatus}. The request has been rejected by the herd. It will not feed here today. A harsh but necessary lesson.`,
          `${f.httpStatus}. Turned away at the gate. Even in the digital world, territorial boundaries are strictly enforced.`,
          `A ${f.httpStatus}. The request approaches, but is rebuffed. It does not belong here. It retreats, dejected but wiser.`,
        ]),
      );
    else if (f.httpStatus >= 200)
      lines.push(
        pick([
          `A ${f.httpStatus}. Success! The request has found nourishment and can return to its caller, mission accomplished.`,
          `${f.httpStatus}. A successful hunt! The response payload is secured. Tonight, the client will feast.`,
          `A ${f.httpStatus}. The cycle completes. The request returns home, payload in hand, like a bee laden with pollen.`,
        ]),
      );
  }

  if (f.exceptionType) {
    lines.push(
      pick([
        `But tragedy strikes. A ${f.exceptionType}${f.exceptionMessage ? ` -- "${short(f.exceptionMessage, 60)}"` : ''} emerges from the undergrowth. In the unforgiving world of production, exceptions show no mercy.`,
        `Suddenly -- a predator. ${f.exceptionType}${f.exceptionMessage ? `: "${short(f.exceptionMessage, 60)}"` : ''}. It strikes without warning. The request never saw it coming.`,
        `Oh dear. A ${f.exceptionType}${f.exceptionMessage ? ` -- "${short(f.exceptionMessage, 60)}"` : ''} has appeared. In the food chain of software, exceptions are the apex predator.`,
      ]),
    );
  }

  if (f.k8sPod) {
    lines.push(
      pick([
        `All of this unfolds within the protective shell of pod "${f.k8sPod}"${f.k8sNamespace ? `, in the "${f.k8sNamespace}" territory` : ''}. A fragile home, one that the scheduler could evict at any moment. Such is life in Kubernetes.`,
        `The habitat: pod "${f.k8sPod}"${f.k8sNamespace ? ` of the "${f.k8sNamespace}" biome` : ''}. A temporary nest -- like a weaver bird's creation, intricate yet disposable.`,
        `This all takes place within pod "${f.k8sPod}"${f.k8sNamespace ? `, in the "${f.k8sNamespace}" preserve` : ''}. A container, much like a tidepool -- a small, self-contained world within a vast ocean.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, roaming the "${f.k8sNamespace}" grasslands` : ''} -- an ephemeral creature. Born from a deployment, destined to be recycled. The circle of life in Kubernetes.`,
        `Deep in the "${f.k8sNamespace || 'default'}" canopy, pod "${f.k8sPod}" clings to its branch. One resource spike, and the eviction predator strikes.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, a denizen of the "${f.k8sNamespace}" reef` : ''} -- it may look permanent, but in Kubernetes, nothing truly is. Even the coral grows and is replaced.`,
        `The nesting ground: pod "${f.k8sPod}"${f.k8sNamespace ? ` in "${f.k8sNamespace}"` : ''}. Like a mayfly, its lifespan is measured not in years, but in rolling updates.`,
      ]),
    );
  } else if (f.hostName) {
    lines.push(
      pick([
        `The habitat: host "${f.hostName}". A single node in an ecosystem of thousands.`,
        `All of this occurs on host "${f.hostName}" -- a permanent fixture in the landscape, like an ancient baobab tree in the savanna.`,
        `The territory: "${f.hostName}". A bare-metal habitat, increasingly rare in this age of containers and cloud.`,
      ]),
    );
  }

  lines.push(
    pick([
      'And so the cycle continues. Requests arrive, responses depart. The great circle of observability.',
      'Extraordinary. Absolutely extraordinary.',
      'Tomorrow, another request will traverse this very path. Such is life in the cluster.',
      'And as the metrics settle, the system rests -- until the next deployment disturbs the peace.',
      'Remarkable. One could watch these systems for hours and still discover something new.',
      'And so we leave the cluster, as we found it -- humming, processing, endlessly fascinating.',
      'One could spend a lifetime studying these systems and never fully understand them. And that, perhaps, is the most extraordinary thing of all.',
      'As the sun sets on this particular request cycle, the ecosystem prepares for what comes next. It always does.',
      'What a privilege it has been to observe this moment. In the grand tapestry of distributed computing, every span tells a story.',
      'The natural world teaches us patience. The digital world teaches us that patience has a timeout of 30 seconds.',
      'Magnificent. Simply magnificent. Though I suspect the oncall engineer might use a different word.',
      'And with that, we take our leave. The cluster carries on, as it has for uptime, and as it will until the next rolling update.',
    ]),
  );

  return lines.join('\n\n');
}
