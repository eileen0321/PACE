// 2026-07-29 사장님 지시 — 홈 배너("몇시에 잠들었어요" 고정 문구)를 사용 습관 인사이트 +
// 신조어 뜻풀이 + 힐링 문구 + 마음을 울리는 문구를 섞은 "매일 하나의 깜짝 선물" 박스로 확장.
// "몇백개, json이잖아 어차피" 지시대로 번역 키 시스템(translations.ts)을 안 거치고 이 파일 하나에
// 언어쌍({en, ko})을 직접 들고 있는다 — 나중에 더 추가하고 싶으면 이 배열에 줄만 더하면 된다.
// 신조어는 실제로 쓰이는지 웹 조사로 확인한 것만 넣었다(존재하지도 않는 유행어를 지어내면 오히려
// "요즘 감각 없는 앱"으로 보일 위험이 큼) — 유행은 빨리 바뀌므로 주기적으로 갈아줄 것.

export type InsightCategory =
  | 'yesterdayLastWatched'
  | 'todayMoreThanAvg'
  | 'todayLessThanAvg'
  | 'slang'
  | 'healing'
  | 'quote';

export type FlatContent = { en: string; ko: string };
// {{time}}/{{diff}} 플레이스홀더 — usageInsight.ts가 실제 값으로 치환한다.
export type StatTemplate = FlatContent;

export const STAT_TEMPLATES: Record<'yesterdayLastWatched' | 'todayMoreThanAvg' | 'todayLessThanAvg', StatTemplate[]> = {
  yesterdayLastWatched: [
    { en: 'You were still watching at {{time}} yesterday 🌙', ko: '어제는 {{time}}까지 보고 계셨네요 🌙' },
    { en: 'Your last video yesterday was at {{time}} 👀 Remember that?', ko: '어제 마지막 영상, {{time}}이었어요 👀 기억나세요?' },
    { en: '{{time}} yesterday — that was your stopping point 🎬', ko: '어제 {{time}}에 멈추셨더라고요 🎬' },
    { en: 'Yesterday wrapped up at {{time}}. A new day, a clean slate ✨', ko: '어제는 {{time}}에 마무리됐어요. 오늘은 새로운 하루예요 ✨' },
    { en: 'Last night, {{time}} was your final scroll 📱', ko: '어젯밤 {{time}}이 마지막 스크롤이었어요 📱' },
  ],
  todayMoreThanAvg: [
    { en: "You're already {{diff}} min over your usual today 📈", ko: '오늘 벌써 평소보다 {{diff}}분 더 보고 있어요 📈' },
    { en: '{{diff}} min past your average! Time for an eye break? 😮‍💨', ko: '평균보다 {{diff}}분 초과! 슬슬 눈 좀 쉬어줄까요? 😮‍💨' },
    { en: 'A {{diff}}-minute bigger day than usual — worth a quick stretch 🙆', ko: '평소보다 {{diff}}분 더 긴 하루네요 — 스트레칭 한 번 어때요 🙆' },
    { en: '{{diff}} extra minutes today. No judgment, just a nudge 👋', ko: '오늘 {{diff}}분 더 봤어요. 혼내는 거 아니에요, 그냥 살짝 알려드리는 거예요 👋' },
    { en: 'Above average by {{diff}} min — your future self might thank you for a pause 🌤️', ko: '평균보다 {{diff}}분 초과 중 — 지금 잠깐 멈추면 내일의 내가 고마워할지도 🌤️' },
  ],
  todayLessThanAvg: [
    { en: "You're {{diff}} min under your average today — nice pace ✨", ko: '오늘은 평균보다 {{diff}}분 덜 봤어요 — 좋은 흐름이에요 ✨' },
    { en: 'Good pace today — {{diff}} min saved vs your average 💪', ko: '오늘 페이스 괜찮은데요? 평균보다 {{diff}}분 절약 중 💪' },
    { en: '{{diff}} minutes lighter than usual. Small wins count 🌱', ko: '평소보다 {{diff}}분 가벼운 하루예요. 작은 성취도 성취예요 🌱' },
    { en: "{{diff}} min under average — you're steering this, not the algorithm 🧭", ko: '평균보다 {{diff}}분 적어요 — 알고리즘이 아니라 내가 방향을 정하고 있다는 뜻이에요 🧭' },
  ],
};

// 신조어 + 뜻풀이 — 실제 쓰이는지 확인된 것만(웹 조사, 2026-07-29 기준). 유행어는 수명이 짧으니
// 몇 달에 한 번씩 이 목록을 갈아주는 걸 권장.
export const SLANG_ITEMS: FlatContent[] = [
  { en: "Today's slang: '억텐' (eok-ten) — forcing extra-high energy you don't actually feel 🎭", ko: "오늘의 신조어: '억텐' — 그럴 기분도 아닌데 억지로 텐션을 끌어올리는 것 🎭" },
  { en: "Today's slang: '킹받네' (king-badne) — King + 열받다(annoyed) = royally irritated 👑", ko: "오늘의 신조어: '킹받네' — King과 '열받다'의 합성어, 아주 열받았다는 뜻 👑" },
  { en: "Today's slang: '얼죽아' — 'freeze to death but iced', a.k.a. iced coffee even in winter ❄️", ko: "오늘의 신조어: '얼죽아' — '얼어 죽어도 아이스', 겨울에도 아아만 고집하는 그 마음 ❄️" },
  { en: "Today's slang: 'parasocial' — feeling close to someone who has no idea you exist 📺", ko: "오늘의 신조어: '파라소셜' — 실제로는 모르는 사람인데 혼자 친밀감을 느끼는 관계 📺" },
  { en: "Today's slang: 'delusional' (used affectionately) — happily living in your own hopeful fantasy 💭", ko: "오늘의 신조어: '딜루셔널' — 현실과 조금 동떨어진, 그래도 행복한 나만의 상상 속 💭" },
  { en: "Today's slang: '갑분싸' — when the mood suddenly, awkwardly drops 🥶", ko: "오늘의 신조어: '갑분싸' — '갑자기 분위기 싸해짐'의 줄임말 🥶" },
  { en: "Today's slang: '존버' — gritting your teeth and holding on no matter what 🦷", ko: "오늘의 신조어: '존버' — 힘들어도 끝까지 버틴다는 뜻 🦷" },
  { en: "Today's slang: '소확행' — a small, certain happiness (like the perfect snack) 🍪", ko: "오늘의 신조어: '소확행' — 작지만 확실한 행복(딱 맞는 간식 같은 거) 🍪" },
  { en: "Today's slang: '답정너' — 'you already decided the answer, you just want me to say it' 🙃", ko: "오늘의 신조어: '답정너' — '답은 정해져 있고 넌 대답만 하면 돼'의 줄임말 🙃" },
  { en: "Today's slang: '인싸/아싸' — insider vs. outsider of the group 🎉", ko: "오늘의 신조어: '인싸/아싸' — 무리에 잘 섞이는 사람 vs. 혼자가 편한 사람 🎉" },
];

export const HEALING_ITEMS: FlatContent[] = [
  { en: "You don't have to finish everything today. Tomorrow will still be there 🌙", ko: '오늘 다 끝내지 않아도 괜찮아요. 내일도 여전히 있어요 🌙' },
  { en: 'Resting is not falling behind. It\'s part of the pace 🍃', ko: '쉬는 건 뒤처지는 게 아니에요. 그것도 페이스의 일부예요 🍃' },
  { en: 'A quiet five minutes can reset more than you think ☁️', ko: '조용한 5분이 생각보다 많은 걸 다시 채워줘요 ☁️' },
  { en: "You're doing better than the version of you from last week 🌱", ko: '지금의 나는 지난주의 나보다 조금 더 나아졌어요 🌱' },
  { en: 'Not every scroll needs a reason. But rest does deserve one too 🤍', ko: '모든 스크롤에 이유가 필요한 건 아니지만, 쉬는 것도 이유가 될 자격이 있어요 🤍' },
  { en: "It's okay to put the phone down mid-video. It'll still be there 📴", ko: '영상 보다가 그냥 꺼도 괜찮아요. 나중에 또 있어요 📴' },
  { en: "Small pace, steady pace. That's still progress 🐢", ko: '느린 걸음도 꾸준하면 그게 나아가는 거예요 🐢' },
  { en: 'Nobody\'s keeping score except the algorithm. You can log off 🌤️', ko: '점수 매기는 건 알고리즘뿐이에요. 언제든 로그아웃해도 돼요 🌤️' },
  { en: 'Your evening doesn\'t owe anyone a highlight reel 🕯️', ko: '오늘 저녁이 꼭 하이라이트일 필요는 없어요 🕯️' },
  { en: "Breathe. You're allowed to just exist without producing anything right now 🫧", ko: '숨 한번 쉬어요. 지금 당장 뭔가 만들어내지 않아도 괜찮아요 🫧' },
];

export const QUOTE_ITEMS: FlatContent[] = [
  { en: '"The time you enjoy wasting is not wasted time." — Bertrand Russell ✨', ko: '"즐기면서 흘려보낸 시간은 낭비한 시간이 아니다." — 버트런드 러셀 ✨' },
  { en: '"Almost everything will work again if you unplug it for a few minutes, including you." — Anne Lamott 🔌', ko: '"거의 모든 것은 잠깐 꺼두면 다시 잘 작동한다, 당신을 포함해서." — 앤 라모트 🔌' },
  { en: '"You don\'t have to control your thoughts. You just have to stop letting them control you." — Dan Millman 🧘', ko: '"생각을 통제할 필요는 없다. 그 생각이 나를 통제하지 못하게만 하면 된다." — 댄 밀먼 🧘' },
  { en: '"Slow down and everything you are chasing will come around and catch you." — John De Paola 🐇', ko: '"천천히 가면, 쫓던 것들이 오히려 나를 따라온다." — 존 드 파올라 🐇' },
  { en: '"Rest is not idleness." — John Lubbock 🌾', ko: '"쉼은 게으름이 아니다." — 존 러벅 🌾' },
  { en: '"You can\'t pour from an empty cup." — unknown ☕', ko: '"빈 잔에서는 아무것도 따를 수 없다." — 작자 미상 ☕' },
  { en: '"Nothing is more expensive than a missed opportunity to rest." — H. Jackson Brown Jr. 🌙', ko: '"쉴 기회를 놓치는 것보다 비싼 건 없다." — H. 잭슨 브라운 주니어 🌙' },
];

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
