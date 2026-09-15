// Course definitions only: no Three.js here so the physics tests can import them in Node.
// points are [x, z] control points of the centerline; the start line sits `pre` meters after the first point.
// elevation keys are [distance from start, ground height]; anchors/gates are placed relative to that ground.
export const MAPS = [
  {
    id: 'sunset', no: '01', theme: 'sunset',
    name: '선셋 애비뉴', en: 'SUNSET AVENUE', tagline: '따뜻한 빛, 긴 그림자, 끝없는 스윙.',
    trait: '곧게 뻗은 대로 · 입문 코스', difficulty: 1, recordKey: 'skyhook.avenue.pendulum.v2',
    points: [[0, 80], [0, -1260]], length: 1050, gates: 7, gateOffsets: [0, -8, 10, 0, -10, 8, 0],
    halfWidth: 22, anchor: { spacing: 52, lateral: 26, heights: [76, 80, 84], first: -25 },
    accent: '#ffc17e',
  },
  {
    id: 'harbor', no: '02', theme: 'harbor',
    name: '네온 하버', en: 'NEON HARBOR', tagline: '물 위로 번지는 네온, S자로 휘는 운하.',
    trait: 'S자 운하 · 크레인 스윙', difficulty: 2, recordKey: 'skyhook.harbor.v1',
    points: [[0, 80], [0, 0], [0, -160], [35, -300], [115, -410], [160, -545], [130, -690], [50, -800], [10, -950], [40, -1100], [115, -1210], [160, -1340], [170, -1460]],
    gates: 8, gateOffsets: [0, 6, -8, 0, 8, -6, 4, 0],
    halfWidth: 24, anchor: { spacing: 48, lateral: 28, heights: [72, 80, 86, 78], first: -25 },
    accent: '#ff5fd2',
  },
  {
    id: 'canyon', no: '03', theme: 'canyon',
    name: '레드 캐니언', en: 'RED CANYON', tagline: '구불구불한 협곡을 따라 끝없이 내리꽂는 활강.',
    trait: '좁은 급커브 · 내리막 가속', difficulty: 3, recordKey: 'skyhook.canyon.v1',
    points: [[0, 80], [0, 0], [0, -110], [-55, -230], [-70, -370], [10, -490], [85, -600], [75, -750], [-10, -860], [-70, -990], [-40, -1130], [30, -1230], [50, -1350], [50, -1470]],
    elevation: [[-100, 0], [60, 0], [300, -18], [650, -48], [1000, -78], [1400, -96]],
    gates: 8, gateOffsets: [0, -4, 5, 0, -5, 4, -3, 0],
    halfWidth: 18, anchor: { spacing: 44, lateral: 22, heights: [72, 80, 76, 84], first: -25, stagger: 22 },
    speedCap: 96, accent: '#ff8a4c',
  },
  {
    id: 'aurora', no: '04', theme: 'aurora',
    name: '오로라 설원', en: 'AURORA PASS', tagline: '오로라 아래 거대한 전나무 숲을 돌아 오르는 헤어핀.',
    trait: '180° 헤어핀 · 오르막 · 옆바람', difficulty: 2, recordKey: 'skyhook.aurora.v1',
    points: [[0, 80], [0, 0], [0, -180], [25, -340], [110, -460], [240, -500], [360, -440], [410, -310], [395, -160], [410, -20], [470, 90], [560, 140], [660, 150], [760, 150]],
    elevation: [[-100, 0], [80, 0], [400, 12], [800, 36], [1200, 50]],
    gates: 8, gateOffsets: [0, 5, -6, 0, 6, -4, 5, 0],
    halfWidth: 22, anchor: { spacing: 50, lateral: 26, heights: [80, 74, 88], first: -25 },
    wind: { strength: 5, period: 6.5 }, accent: '#7dffc8',
  },
  {
    id: 'garden', no: '05', theme: 'garden',
    name: '구름 정원', en: 'CLOUD GARDEN', tagline: '구름 바다 위 떠 있는 섬들, 롤러코스터 같은 고저차.',
    trait: '나선 곡선 · 파도형 고저차 · 저중력', difficulty: 3, recordKey: 'skyhook.garden.v1',
    points: [[0, 80], [0, 0], [-15, -150], [-80, -290], [-210, -350], [-350, -310], [-420, -190], [-400, -50], [-320, 60], [-190, 110], [-120, 230], [-130, 360], [-170, 480]],
    elevation: [[-100, 0], [60, 0], [240, 18], [420, 2], [600, 24], [780, 6], [960, 28], [1140, 10], [1320, 22]],
    gates: 9, gateOffsets: [0, -6, 6, 12, -8, 8, 10, -12, 0], gateLift: 54, gateHeight: 44,
    halfWidth: 26, anchor: { spacing: 52, lateral: 30, heights: [78, 86, 74, 82], first: -25 },
    gravity: -30, speedCap: 88, accent: '#8fd3ff',
  },
  {
    id: 'jungle', no: '06', theme: 'jungle',
    name: '에메랄드 정글', en: 'EMERALD RUINS', tagline: '안개 낀 정글 신전, 석조 아치 아래를 지그재그로.',
    trait: '연속 지그재그 · 석조 아치 통과 · 오르막 뒤 급강하', difficulty: 3, recordKey: 'skyhook.jungle.v1',
    points: [[0, 80], [0, 0], [0, -150], [85, -270], [95, -410], [5, -530], [-5, -670], [85, -790], [95, -930], [5, -1050], [-5, -1190], [40, -1310], [45, -1440], [45, -1560]],
    elevation: [[-100, 0], [80, 0], [420, 26], [700, 30], [1000, 6], [1300, -18]],
    gates: 8, gateOffsets: [0, 0, 0, 0, 0, 0, 0, 0],
    halfWidth: 22, anchor: { spacing: 46, lateral: 26, heights: [74, 82, 78, 86], first: -25 },
    // Stone arches span the course between checkpoints: fly under the lintel, between the pillars.
    arches: [.19, .44, .69, .94], archOpening: { halfWidth: 22, height: 104 },
    accent: '#6fe08a',
  },
];
