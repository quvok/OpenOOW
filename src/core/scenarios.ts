import type { VesselState, CpaResult } from "./navigation";
import { calculateCpa } from "./navigation";
import type { ColregEnvironment, ColregVesselProfile } from "./colreg";

export interface ScenarioColregContext {
  ownProfile?: Partial<ColregVesselProfile>;
  targetProfile?: Partial<ColregVesselProfile>;
  environment?: Partial<ColregEnvironment>;
}

export interface EncounterScenario {
  id: string;
  title: string;
  category: string;
  description: string;
  task: string;
  ruleReference: string;
  ownShip: { courseDeg: number; speedKn: number };
  targets: VesselState[];
  visibilityNm: number;
  colregContext?: ScenarioColregContext;
  debrief: string[];
}

export const ENCOUNTER_SCENARIOS: EncounterScenario[] = [
  {
    id: "head-on",
    title: "Встречное сближение",
    category: "МППСС-72 · Правило 14",
    description: "Два механических судна идут почти прямо навстречу друг другу. Цель обнаружена на носовых курсовых углах.",
    task: "Определите ситуацию по радару и выполните заблаговременное и решительное изменение курса вправо, чтобы пройти левыми бортами.",
    ruleReference: "Правило 14 — ситуация сближения на противоположных или почти противоположных курсах.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [{ id: "T1", xNm: 0.05, yNm: 2.5, courseDeg: 180, speedKn: 10 }],
    visibilityNm: 12,
    debrief: [
      "Проверьте, действительно ли наблюдается ситуация встречного сближения.",
      "Оцените изменение пеленга и дистанции, а не только визуальное положение цели.",
      "После манёвра убедитесь в безопасном расхождении и контролируйте цель до прохода."
    ]
  },
  {
    id: "crossing-give-way",
    title: "Пересечение: своё судно уступает",
    category: "МППСС-72 · Правило 15",
    description: "Цель находится справа от собственного судна и пересекает его курс. Расчётная точка сближения опасно близка.",
    task: "Как судно, обязанное уступить дорогу, выберите ранний и заметный манёвр. Не пересекайте курс цели перед её носом.",
    ruleReference: "Правила 15–16 — ситуация пересечения и действия судна, уступающего дорогу.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [{ id: "T1", xNm: 1.2, yNm: 1.2, courseDeg: 270, speedKn: 10 }],
    visibilityNm: 12,
    debrief: [
      "Цель наблюдается на правом борту: проверьте применимость правила 15.",
      "Судно, уступающее дорогу, должно по возможности избегать пересечения курса цели перед её носом.",
      "Проверьте, что манёвр достаточно велик и приводит к безопасному проходу."
    ]
  },
  {
    id: "overtaking",
    title: "Обгон",
    category: "МППСС-72 · Правило 13",
    description: "Собственное судно быстрее догоняет судно, идущее впереди тем же курсом.",
    task: "Распознайте обгон и обеспечьте проход на безопасном расстоянии. Сохраняйте ответственность обгоняющего до окончательного прохода и чистого расхождения.",
    ruleReference: "Правило 13 — любое судно, обгоняющее другое, должно держаться в стороне от пути обгоняемого.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [{ id: "T1", xNm: -0.15, yNm: 1.8, courseDeg: 0, speedKn: 6 }],
    visibilityNm: 12,
    debrief: [
      "Проверьте сектор обгона: цель должна находиться более чем в 22,5° позади траверза.",
      "Обгоняющее судно обязано держаться в стороне независимо от того, изменяет ли обгоняемое судно курс.",
      "Не считайте обгон завершённым, пока цель не оставлена далеко позади и окончательно."
    ]
  },
  {
    id: "restricted-visibility",
    title: "Ограниченная видимость",
    category: "МППСС-72 · Правило 19",
    description: "Видимость ухудшилась до 1,5 мили. Цель обнаружена радаром на носовом курсовом угле.",
    task: "Действуйте с безопасной скоростью, держите машины готовыми к немедленному манёвру и оцените риск сближения по радару. Не используйте правило 14 автоматически: условия ограниченной видимости рассматриваются по правилу 19.",
    ruleReference: "Правило 19 — действия судов при плавании в условиях ограниченной видимости.",
    ownShip: { courseDeg: 0, speedKn: 8 },
    targets: [{ id: "T1", xNm: 0.2, yNm: 1.2, courseDeg: 180, speedKn: 8 }],
    visibilityNm: 1.5,
    colregContext: { environment: { visibility: "restricted", vesselsInSight: false, daylight: false } },
    debrief: [
      "Снизьте скорость до безопасной с учётом видимости, управляемости и плотности движения.",
      "Используйте радарную информацию для оценки риска, проверяя систематическое наблюдение.",
      "Избегайте поворота влево для цели впереди траверза, кроме случая обгона."
    ]
  },
  {
    id: "multiple-targets",
    title: "Две цели: приоритет риска",
    category: "ARPA · оценка нескольких целей",
    description: "Одновременно наблюдаются две цели: одна пересекает курс справа, другая приближается слева. Нужно оценить обе, а не маневрировать по одной изолированно.",
    task: "Сравните CPA/TCPA обеих целей, определите наиболее опасную ситуацию и выберите манёвр, который не создаст опасного сближения со второй целью.",
    ruleReference: "Оценка риска столкновения; применимые правила МППСС-72 определяются отдельно для каждой ситуации.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [
      { id: "T1", xNm: 1.2, yNm: 1.2, courseDeg: 270, speedKn: 10 },
      { id: "T2", xNm: -1, yNm: 2, courseDeg: 180, speedKn: 8 }
    ],
    visibilityNm: 12,
    debrief: [
      "Сопоставьте CPA и TCPA всех сопровождаемых целей.",
      "Не допускайте, чтобы манёвр для одной цели создал опасность для другой.",
      "После манёвра повторно оцените всю картину движения."
    ]
  }
,
  {
    id: "sailing-rule12",
    title: "Парусные суда: разные галсы",
    category: "МППСС-72 · Правило 12",
    description: "Два парусных судна сближаются на пересекающихся курсах. Собственное судно идёт левым галсом, цель — правым.",
    task: "Определите галсы и примените правило 12. Не путайте наветренное/подветренное положение с правым/левым бортом.",
    ruleReference: "Правило 12 — парусные суда.",
    ownShip: { courseDeg: 0, speedKn: 6 },
    targets: [{ id: "T1", xNm: 1, yNm: 1, courseDeg: 270, speedKn: 6 }],
    visibilityNm: 10,
    colregContext: {
      ownProfile: { kind: "sailing", tack: "port" },
      targetProfile: { kind: "sailing", tack: "starboard" },
      environment: { visibility: "good", vesselsInSight: true, daylight: true },
    },
    debrief: [
      "Проверьте, какое судно идёт левым галсом, а какое правым.",
      "Судно левым галсом уступает судну правым галсом.",
      "Если оба судна на одном галсе, отдельно определите наветренное и подветренное положение."
    ]
  },
  {
    id: "fishing-rule18",
    title: "Механическое судно и рыболовное",
    category: "МППСС-72 · Правило 18",
    description: "Механическое судно пересекается с судном, фактически занятым ловом рыбы.",
    task: "Установите статус рыболовного судна. Не путайте судно, занятое ловом, с обычным механическим судном, которое лишь перевозит рыболовные снасти.",
    ruleReference: "Правило 18 — механическое судно держится в стороне от судна, занятого ловом рыбы.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [{ id: "T1", xNm: 1, yNm: 1, courseDeg: 270, speedKn: 8 }],
    visibilityNm: 10,
    colregContext: {
      ownProfile: { kind: "power-driven", lengthM: 120 },
      targetProfile: { kind: "fishing", engagedInFishing: true, lengthM: 28 },
      environment: { visibility: "good", vesselsInSight: true, daylight: false },
    },
    debrief: [
      "Проверьте, действительно ли цель занята ловом рыбы.",
      "Механическое судно должно держаться в стороне от пути рыболовного судна.",
      "Соблюдайте также общие правила наблюдения, безопасной скорости и предупреждения столкновения."
    ]
  },
  {
    id: "nuc-rule18",
    title: "Механическое судно и NUC",
    category: "МППСС-72 · Правило 18",
    description: "На радаре и визуально наблюдается судно, не способное управляться из-за исключительного обстоятельства.",
    task: "Распознайте обозначение NUC и оцените обязанности собственного механического судна.",
    ruleReference: "Правило 18 — механическое судно держится в стороне от судна, не способного управляться.",
    ownShip: { courseDeg: 0, speedKn: 10 },
    targets: [{ id: "T1", xNm: 1, yNm: 1, courseDeg: 270, speedKn: 0 }],
    visibilityNm: 10,
    colregContext: {
      ownProfile: { kind: "power-driven", lengthM: 95 },
      targetProfile: { kind: "nuc", underway: true, makingWay: false, lengthM: 45 },
      environment: { visibility: "good", vesselsInSight: true, daylight: true },
    },
    debrief: [
      "NUC обозначается двумя красными круговыми огнями или двумя шарами по вертикали.",
      "Механическое судно должно держаться в стороне от пути NUC.",
      "Не делайте вывод о статусе NUC только по малой скорости или остановке."
    ]
  },
  {
    id: "narrow-channel-rule9",
    title: "Узкий проход: малое судно",
    category: "МППСС-72 · Правило 9",
    description: "Малое механическое судно находится в узком фарватере, по которому следует крупное судно, способное безопасно идти только в его пределах.",
    task: "Оцените обязанность малого судна не затруднять проход крупного судна и положение относительно правой границы фарватера.",
    ruleReference: "Правило 9 — узкие проходы и фарватеры.",
    ownShip: { courseDeg: 0, speedKn: 7 },
    targets: [{ id: "T1", xNm: 0.2, yNm: 2, courseDeg: 180, speedKn: 8 }],
    visibilityNm: 8,
    colregContext: {
      ownProfile: { kind: "power-driven", lengthM: 15 },
      targetProfile: { kind: "power-driven", lengthM: 180 },
      environment: { visibility: "good", vesselsInSight: true, narrowChannel: true, targetCanOnlyNavigateChannel: true },
    },
    debrief: [
      "Судно должно держаться ближе к правой внешней границе фарватера, насколько это безопасно и практически возможно.",
      "Судно длиной менее 20 м не должно затруднять проход судна, способного безопасно идти только в пределах узкого прохода.",
      "Учитывайте местные правила и фактическую геометрию фарватера."
    ]
  },
  {
    id: "tss-rule10",
    title: "Пересечение системы разделения движения",
    category: "МППСС-72 · Правило 10",
    description: "Собственное судно пересекает полосу движения, по которой следует другое механическое судно.",
    task: "Оцените пересечение полосы под прямым углом и обязанность не затруднять проход судна, следующего по полосе.",
    ruleReference: "Правило 10 — системы разделения движения.",
    ownShip: { courseDeg: 90, speedKn: 10 },
    targets: [{ id: "T1", xNm: 1, yNm: -0.2, courseDeg: 0, speedKn: 8 }],
    visibilityNm: 10,
    colregContext: {
      ownProfile: { kind: "power-driven", lengthM: 80 },
      targetProfile: { kind: "power-driven", lengthM: 140 },
      environment: { visibility: "good", vesselsInSight: true, trafficSeparationScheme: true, ownCrossingTrafficLane: true, targetFollowingTrafficLane: true },
    },
    debrief: [
      "Если пересечение полосы необходимо, выполняйте его по возможности под прямым углом к общему направлению потока.",
      "Не затрудняйте безопасный проход судна, следующего по полосе.",
      "Правило 10 не отменяет обязанности оценивать риск столкновения и применять остальные правила."
    ]
  }
];

export function getScenarioTargetCpa(scenario: EncounterScenario): Array<{ target: VesselState; cpa: CpaResult | null }> {
  const own: VesselState = {
    id: "OWN",
    xNm: 0,
    yNm: 0,
    courseDeg: scenario.ownShip.courseDeg,
    speedKn: scenario.ownShip.speedKn
  };
  return scenario.targets.map((target) => ({ target, cpa: calculateCpa(own, target) }));
}
