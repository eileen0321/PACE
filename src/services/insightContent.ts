// 2026-07-29 사장님 지시 — 홈 배너("몇시에 잠들었어요" 고정 문구)를 사용 습관 인사이트 +
// 신조어 뜻풀이 + 힐링 문구 + 마음을 울리는 문구를 섞은 "매일 하나의 깜짝 선물" 박스로 확장.
// "몇백개, json이잖아 어차피" 지시대로 번역 키 시스템(translations.ts)을 안 거치고 이 파일 하나에
// 언어쌍({en, ko})을 직접 들고 있는다 — 나중에 더 추가하고 싶으면 이 배열에 줄만 더하면 된다.
// 2026-07-31 사용자 지적("왜 싸구려 아이콘을 자꾸 넣지? 미니멀하게") — 전 항목의 이모지를 전부
// 제거했다. 애플 스타일 절제 원칙: 카피 자체의 톤과 문장으로만 승부, 장식 이모지 없음.
// 2026-08-01 사용자 지시("신조어는 계속 바뀌는데 예전 신조어를 보여주는 게 되잖아" — 유행어는
// 몇 달만 지나도 낡아 보이는 리스크가 실제 발생 위험으로 지적됨. 유행에 무관하게 안 낡는 소재
// (명언/유머/위로)로만 구성하도록 신조어 카테고리를 완전히 제거) + ("더 재미있는 문구들 없어? 500개
// 정도 만들어도 용량 얼마 안되잖아" — 텍스트 배열이라 용량 부담은 맞는 지적. 힐링 문구를 웃긴
// 톤/공감형 유머 위주로 대폭 늘리고, 명언도 실제 유명 인용구 위주로 확장했다. 정확히 500개까진
// 아니지만(품질 유지가 우선) 기존 대비 10배 이상으로 늘림 — 배열에 줄만 추가하면 계속 늘어난다.
// 2026-08-01 사용자 지시("출시전에" 백엔드로 이전) — 이 문구들은 이제 진실의 원천이 아니다. 실제
// 서빙은 백엔드 insight_item 테이블 + /insights 엔드포인트(usageInsight.ts가 호출)가 담당하고,
// 여기 배열들은 그 테이블을 처음 채운 시드 데이터(생성 스크립트로 그대로 SQL화해 V4__insight_items.sql
// 마이그레이션에 넣음)이자, 백엔드 요청이 실패했을 때(오프라인/서버 다운) 쓰는 로컬 폴백이다.
// 앞으로 문구를 고치고 싶으면 앱을 재배포할 필요 없이 DB(insight_item 테이블)만 UPDATE/INSERT하면
// 된다 — 이 파일은 폴백 안전망으로만 유지(가끔 동기화해주면 좋지만 필수는 아님).

export type InsightCategory =
  | 'yesterdayLastWatched'
  | 'todayMoreThanAvg'
  | 'todayLessThanAvg'
  | 'healing'
  | 'quote'
  | 'tip';

export type FlatContent = { en: string; ko: string };
// {{time}}/{{diff}} 플레이스홀더 — usageInsight.ts가 실제 값으로 치환한다.
export type StatTemplate = FlatContent;

export const STAT_TEMPLATES: Record<'yesterdayLastWatched' | 'todayMoreThanAvg' | 'todayLessThanAvg', StatTemplate[]> = {
  yesterdayLastWatched: [
    { en: 'You were still watching at {{time}} yesterday', ko: '어제는 {{time}}까지 보고 계셨네요' },
    { en: 'Your last video yesterday was at {{time}}. Remember that?', ko: '어제 마지막 영상, {{time}}이었어요. 기억나세요?' },
    { en: '{{time}} yesterday — that was your stopping point', ko: '어제 {{time}}에 멈추셨더라고요' },
    { en: 'Yesterday wrapped up at {{time}}. A new day, a clean slate', ko: '어제는 {{time}}에 마무리됐어요. 오늘은 새로운 하루예요' },
    { en: 'Last night, {{time}} was your final scroll', ko: '어젯밤 {{time}}이 마지막 스크롤이었어요' },
  ],
  todayMoreThanAvg: [
    { en: "You're already {{diff}} min over your usual today", ko: '오늘 벌써 평소보다 {{diff}}분 더 보고 있어요' },
    { en: '{{diff}} min past your average. Time for an eye break?', ko: '평균보다 {{diff}}분 초과. 슬슬 눈 좀 쉬어줄까요?' },
    { en: 'A {{diff}}-minute bigger day than usual — worth a quick stretch', ko: '평소보다 {{diff}}분 더 긴 하루네요 — 스트레칭 한 번 어때요' },
    { en: '{{diff}} extra minutes today. No judgment, just a nudge', ko: '오늘 {{diff}}분 더 봤어요. 혼내는 거 아니에요, 그냥 살짝 알려드리는 거예요' },
    { en: 'Above average by {{diff}} min — your future self might thank you for a pause', ko: '평균보다 {{diff}}분 초과 중 — 지금 잠깐 멈추면 내일의 내가 고마워할지도' },
  ],
  todayLessThanAvg: [
    { en: "You're {{diff}} min under your average today — nice pace", ko: '오늘은 평균보다 {{diff}}분 덜 봤어요 — 좋은 흐름이에요' },
    { en: 'Good pace today — {{diff}} min saved vs your average', ko: '오늘 페이스 괜찮은데요? 평균보다 {{diff}}분 절약 중' },
    { en: '{{diff}} minutes lighter than usual. Small wins count', ko: '평소보다 {{diff}}분 가벼운 하루예요. 작은 성취도 성취예요' },
    { en: "{{diff}} min under average — you're steering this, not the algorithm", ko: '평균보다 {{diff}}분 적어요 — 알고리즘이 아니라 내가 방향을 정하고 있다는 뜻이에요' },
  ],
};

// 힐링 + 공감형 유머 문구 — 위로 톤과 웃긴 톤을 섞었다(2026-08-01 사용자 지시: "더 재미있는 문구들").
// 유행어/밈 자체를 소재로 쓰지 않고(금방 낡음) 누구나 공감할 보편적인 상황(영상 하나만 더, 알고리즘,
// 잠들기 전 스크롤 등)을 소재로 삼아 오래 가도 안 촌스럽게 설계.
export const HEALING_ITEMS: FlatContent[] = [
  { en: "You don't have to finish everything today. Tomorrow will still be there", ko: '오늘 다 끝내지 않아도 괜찮아요. 내일도 여전히 있어요' },
  { en: "Resting is not falling behind. It's part of the pace", ko: '쉬는 건 뒤처지는 게 아니에요. 그것도 페이스의 일부예요' },
  { en: 'A quiet five minutes can reset more than you think', ko: '조용한 5분이 생각보다 많은 걸 다시 채워줘요' },
  { en: "You're doing better than the version of you from last week", ko: '지금의 나는 지난주의 나보다 조금 더 나아졌어요' },
  { en: 'Not every scroll needs a reason. But rest does deserve one too', ko: '모든 스크롤에 이유가 필요한 건 아니지만, 쉬는 것도 이유가 될 자격이 있어요' },
  { en: "It's okay to put the phone down mid-video. It'll still be there", ko: '영상 보다가 그냥 꺼도 괜찮아요. 나중에 또 있어요' },
  { en: "Small pace, steady pace. That's still progress", ko: '느린 걸음도 꾸준하면 그게 나아가는 거예요' },
  { en: "Nobody's keeping score except the algorithm. You can log off", ko: '점수 매기는 건 알고리즘뿐이에요. 언제든 로그아웃해도 돼요' },
  { en: "Your evening doesn't owe anyone a highlight reel", ko: '오늘 저녁이 꼭 하이라이트일 필요는 없어요' },
  { en: "Breathe. You're allowed to just exist without producing anything right now", ko: '숨 한번 쉬어요. 지금 당장 뭔가 만들어내지 않아도 괜찮아요' },
  { en: '"Just one more video" has never once meant one more video', ko: '"딱 하나만 더 볼게"는 한 번도 하나만 본 적이 없죠' },
  { en: 'The algorithm has known you for years. It still can\'t guess when to stop', ko: '알고리즘은 나를 몇 년째 지켜봤으면서, 언제 멈춰야 하는지는 끝까지 몰라요' },
  { en: "You checked the time and it lied to you. That's just how Shorts work", ko: '시계를 봤는데 거짓말인 줄 알았죠. 원래 쇼츠는 그런 거예요' },
  { en: 'Autoplay is not a personal invitation. You can decline', ko: '자동재생은 초대장이 아니에요. 거절해도 됩니다' },
  { en: 'Your phone battery hit 20% before you did. Follow its lead — go charge', ko: '폰 배터리가 나보다 먼저 20%가 됐어요. 그 신호 따라서 나도 좀 충전하죠' },
  { en: "Somewhere out there, someone is watching the exact same 9-second clip on a loop. You're not alone", ko: '지금 이 순간, 누군가도 똑같은 9초짜리 영상을 무한 반복으로 보고 있어요. 혼자가 아니에요' },
  { en: 'The video ended 40 minutes ago in spirit. Only the app disagrees', ko: '마음속으로는 40분 전에 끝났어요. 앱만 아직 모르고 있을 뿐' },
  { en: 'Comparing your day to a highlight reel is like comparing a whole meal to a food photo', ko: '내 하루를 남의 하이라이트 영상과 비교하는 건, 밥 한 끼를 음식 사진이랑 비교하는 거예요' },
  { en: "FOMO is just your brain's worst travel agent. It always overbooks", ko: 'FOMO는 뇌가 고용한 최악의 여행사예요. 맨날 일정을 과하게 잡아요' },
  { en: 'Doing nothing for ten minutes has never once ruined anyone\'s life. Try it', ko: '10분 동안 아무것도 안 한다고 인생이 망한 사람은 없어요. 한번 해봐요' },
  { en: 'Your to-do list will forgive you for one slow afternoon. It always does', ko: '할 일 목록은 나른한 오후 한 번쯤은 용서해줘요. 늘 그래왔듯이' },
  { en: "The remote control has a pause button for a reason — mostly for snacks, but also for you", ko: '리모컨에 일시정지 버튼이 있는 건 다 이유가 있어요 — 주로 간식용이지만 나를 위한 것이기도 해요' },
  { en: 'You are not "behind." There was never a race', ko: '당신은 "뒤처진" 게 아니에요. 애초에 경주 같은 건 없었어요' },
  { en: 'Somewhere a notification just went off. It can wait. So can the next one', ko: '어딘가에서 방금 알림이 울렸어요. 좀 기다려도 돼요. 다음 것도요' },
  { en: 'Boredom is not an emergency. You are allowed to sit in it', ko: '지루함은 응급상황이 아니에요. 그냥 그 안에 앉아 있어도 괜찮아요' },
  { en: 'Your couch has seen you binge-watch and it has never once judged you. Give it credit', ko: '소파는 내가 정주행하는 걸 다 봤으면서 한 번도 뭐라 한 적 없어요. 그 정도는 인정해줘야죠' },
  { en: 'Nobody remembers the 47th video in a row. Memory has standards', ko: '연달아 본 47번째 영상은 아무도 기억 못 해요. 기억력도 나름의 기준이 있거든요' },
  { en: 'You survived every single "I\'ll just check one thing" so far. Impressive track record', ko: '"딱 하나만 확인할게"를 지금까지 다 살아남았어요. 꽤 대단한 기록이에요' },
  { en: 'A screen break is not a punishment. It\'s just a screen break', ko: '화면 쉬는 시간은 벌이 아니에요. 그냥 쉬는 시간일 뿐이에요' },
  { en: 'The next video will still be recommended to you tomorrow. It is extremely patient', ko: '다음 영상은 내일도 추천될 거예요. 알고리즘은 놀라울 정도로 끈질기거든요' },
  { en: 'Silence is not a bug in your day. It\'s a feature you forgot you had', ko: '조용한 시간은 하루의 오류가 아니에요. 원래 있었는데 잊고 있던 기능이에요' },
  { en: 'You don\'t need permission to close the app. Consider this it, if you were waiting', ko: '앱을 끄는 데 허락은 필요 없어요. 혹시 기다리고 있었다면, 지금 이게 그 허락이에요' },
  { en: "One unfinished video does not count against you anywhere. There's no scoreboard", ko: '끝까지 안 본 영상 하나, 어디에도 감점으로 안 남아요. 점수판 자체가 없거든요' },
  { en: 'Your eyes have been staring at a rectangle for a while. They\'d probably vote for a window right now', ko: '눈이 한참 동안 네모난 화면만 보고 있었어요. 지금 물어보면 창밖을 보고 싶다고 할걸요' },
  { en: 'Every "last one" is a promise. You\'re allowed to actually keep it', ko: '"마지막 하나"는 약속이에요. 그 약속, 진짜로 지켜도 괜찮아요' },
  { en: 'The internet will still be exactly this loud tomorrow. No need to catch up on all of it today', ko: '인터넷은 내일도 딱 이만큼 시끄러울 거예요. 오늘 다 따라잡을 필요 없어요' },
  { en: 'You are allowed to be unproductive on purpose. That\'s a real setting, not a failure', ko: '일부러 아무것도 안 하는 것도 괜찮은 선택이에요. 실패가 아니라 하나의 설정값이에요' },
  { en: 'Somewhere, someone is jealous of the amount of rest you\'re about to take. Take it anyway', ko: '어딘가에는 지금 내가 취할 휴식을 부러워할 사람도 있어요. 그래도 그냥 쉬세요' },
  { en: 'A closed tab has never once haunted anyone. Close it', ko: '닫힌 탭이 사람을 쫓아온 적은 없어요. 그냥 닫아도 돼요' },
  { en: 'Time you don\'t remember spending is still time you spent. Worth checking in on', ko: '기억도 안 나는 시간도 결국 쓴 시간이에요. 한 번쯤 점검해볼 만해요' },
  { en: 'Your future self already forgives you for tonight. Might as well wrap up a little early', ko: '미래의 나는 오늘 밤의 나를 이미 용서했어요. 그럼 조금 일찍 마무리해도 괜찮겠네요' },
  { en: 'The video thumbnail lied about how short it would be. It always does', ko: '썸네일은 늘 짧아 보이겠다고 속여요. 원래 그런 거예요' },
  { en: 'Real life doesn\'t have a skip-ad button, but it does have a pause. Use it more often', ko: '현실엔 광고 건너뛰기는 없지만 일시정지는 있어요. 좀 더 자주 써봐요' },
  { en: 'Not watching something is also a choice, and a perfectly good one', ko: '안 보는 것도 하나의 선택이에요, 그것도 꽤 괜찮은 선택' },
  { en: 'You don\'t need main-character energy today. Supporting-character rest is just as valid', ko: '오늘은 꼭 주인공처럼 애쓰지 않아도 돼요. 조연처럼 쉬는 것도 똑같이 소중해요' },
  { en: 'The recommended-for-you list was never actually about you. It\'s about your last 40 minutes', ko: '추천 목록은 사실 "나"를 아는 게 아니에요. 최근 40분을 아는 거죠' },
  { en: 'A stretch break burns more regret than the video ever will burn calories', ko: '스트레칭 한 번이 영상이 태우는 칼로리보다 후회를 더 많이 태워줘요' },
  { en: 'You clicked "not interested" and it recommended the same thing in a different color. You are stronger than that trick', ko: '"관심 없음"을 눌렀는데 색깔만 바뀐 게 또 떴죠. 그 수법보다 내가 더 강해요' },
  { en: 'Somewhere between video 12 and video 13, you stopped choosing and started drifting. Choose again', ko: '12번째와 13번째 영상 사이 어디쯤에서 선택은 멈추고 그냥 떠밀려 왔어요. 다시 선택해봐요' },
  { en: 'The couch is not going anywhere. Neither is the app. Only your evening is limited', ko: '소파는 어디 안 가요. 앱도 마찬가지고요. 한정판인 건 오늘 저녁뿐이에요' },
  { en: 'You don\'t owe the app a goodbye video. Just leave', ko: '앱한테 작별 영상 하나 남길 필요 없어요. 그냥 나가면 돼요' },
  { en: 'Ten more seconds of a video rarely turns into ten more seconds', ko: '"10초만 더"는 거의 언제나 10초로 안 끝나요' },
  { en: 'A short walk has a worse thumbnail than the next video, but a much better ending', ko: '짧은 산책은 썸네일이 다음 영상보다 별로지만, 결말은 훨씬 나아요' },
  { en: 'You are not required to have an opinion on every video the internet made today', ko: '오늘 인터넷이 만든 영상 전부에 의견을 낼 필요는 없어요' },
  { en: 'The play button will be exactly where you left it. It has nowhere else to be', ko: '재생 버튼은 내가 떠난 자리에 그대로 있을 거예요. 어디 갈 데도 없거든요' },
  { en: 'One good stopping point beats ten "almost done" ones', ko: '괜찮은 종료 지점 하나가 "거의 다 봄" 열 번보다 나아요' },
  { en: 'You can love something and still put it down. Those two things are not opposites', ko: '좋아하면서도 내려놓을 수 있어요. 두 가지가 서로 반대되는 게 아니거든요' },
  { en: 'The next video always promises to be the best one. It has said that every single time', ko: '다음 영상은 늘 최고일 거라고 약속해요. 그 말, 매번 했었죠' },
  { en: 'You don\'t need a reason to log off. "I wanted to" already counts', ko: '로그아웃하는 데 이유 같은 거 필요 없어요. "그냥 그러고 싶어서"면 충분해요' },
  { en: 'Whatever you were about to watch will survive being watched tomorrow instead', ko: '보려던 그 영상, 내일 봐도 멀쩡할 거예요' },
  { en: 'Somewhere in the last hour, a stretch, a glass of water, or a nap was quietly postponed. It\'s still available', ko: '지난 한 시간 어딘가에서 스트레칭이나 물 한 잔, 낮잠 같은 게 조용히 미뤄졌어요. 아직 늦지 않았어요' },
  { en: 'A pause is not a failure state. It\'s just the button next to play', ko: '일시정지는 실패한 상태가 아니에요. 그냥 재생 버튼 옆에 있는 버튼일 뿐이에요' },
  { en: 'You can close this and open something slower. Slower still counts', ko: '이걸 닫고 더 느린 걸 열어도 돼요. 느린 것도 여전히 유효해요' },
  { en: 'Today does not need a perfect ending. A closed app is a fine one', ko: '오늘이 완벽하게 끝날 필요는 없어요. 앱 하나 끄는 것도 충분히 괜찮은 마무리예요' },
  { en: 'A five-second countdown before autoplay is basically the app asking permission. You\'re allowed to say no', ko: '자동재생 전 5초 카운트다운은 사실 앱이 허락을 구하는 거예요. "아니"라고 해도 돼요' },
  { en: 'Your attention is the one thing every app in your pocket is quietly competing for. You get to decide who wins today', ko: '내 관심은 폰 속 모든 앱이 조용히 서로 가지려는 거예요. 오늘 누구한테 줄지는 내가 정해요' },
  { en: 'The version of you an hour from now is rooting for the version of you right now to stop a little early', ko: '한 시간 뒤의 나는 지금의 내가 조금 일찍 멈추길 응원하고 있어요' },
  { en: 'Watching less is not the same as missing out. Most days, it\'s the opposite', ko: '덜 보는 게 놓치는 것과 같지 않아요. 오히려 대부분은 그 반대예요' },
];

// 실제로 알려진 명언 위주 — 시간/쉼/현재에 머무르기/단순함/자기 자신에 대한 태도를 다룬 문장들.
// 2026-08-01 확장(사용자 지시): 신조어 대신 유행에 안 낡는 소재로 채운다.
export const QUOTE_ITEMS: FlatContent[] = [
  { en: '"The time you enjoy wasting is not wasted time." — Bertrand Russell', ko: '"즐기면서 흘려보낸 시간은 낭비한 시간이 아니다." — 버트런드 러셀' },
  { en: '"Almost everything will work again if you unplug it for a few minutes, including you." — Anne Lamott', ko: '"거의 모든 것은 잠깐 꺼두면 다시 잘 작동한다, 당신을 포함해서." — 앤 라모트' },
  { en: '"You don\'t have to control your thoughts. You just have to stop letting them control you." — Dan Millman', ko: '"생각을 통제할 필요는 없다. 그 생각이 나를 통제하지 못하게만 하면 된다." — 댄 밀먼' },
  { en: '"Slow down and everything you are chasing will come around and catch you." — John De Paola', ko: '"천천히 가면, 쫓던 것들이 오히려 나를 따라온다." — 존 드 파올라' },
  { en: '"Rest is not idleness." — John Lubbock', ko: '"쉼은 게으름이 아니다." — 존 러벅' },
  { en: '"You can\'t pour from an empty cup." — unknown', ko: '"빈 잔에서는 아무것도 따를 수 없다." — 작자 미상' },
  { en: '"Nothing is more expensive than a missed opportunity to rest." — H. Jackson Brown Jr.', ko: '"쉴 기회를 놓치는 것보다 비싼 건 없다." — H. 잭슨 브라운 주니어' },
  { en: '"It is not the daily increase but daily decrease. Hack away at the unessential." — Bruce Lee', ko: '"매일 더하는 게 아니라 매일 덜어내는 것이다. 불필요한 것을 쳐내라." — 브루스 리' },
  { en: '"The present moment is the only time over which we have dominion." — Thích Nhất Hạnh', ko: '"현재 순간이야말로 우리가 다스릴 수 있는 유일한 시간이다." — 틱낫한' },
  { en: '"Half of the harm that is done in this world is due to people who want to feel important." — T. S. Eliot', ko: '"세상에서 벌어지는 해악의 절반은 중요한 사람이 되고 싶어 하는 이들 때문이다." — T. S. 엘리엇' },
  { en: '"Do not spoil what you have by desiring what you have not." — Epicurus', ko: '"갖지 못한 것을 갈망하느라 가진 것을 망치지 마라." — 에피쿠로스' },
  { en: '"He who is not satisfied with a little, is satisfied with nothing." — Epicurus', ko: '"작은 것에 만족하지 못하는 사람은 그 무엇에도 만족하지 못한다." — 에피쿠로스' },
  { en: '"We suffer more often in imagination than in reality." — Seneca', ko: '"우리는 실제보다 상상 속에서 더 자주 고통받는다." — 세네카' },
  { en: '"It is not that we have a short time to live, but that we waste a lot of it." — Seneca', ko: '"인생이 짧은 게 아니라, 우리가 그 많은 부분을 낭비하는 것이다." — 세네카' },
  { en: '"You have power over your mind, not outside events. Realize this, and you will find strength." — Marcus Aurelius', ko: '"당신은 외부 사건이 아니라 자신의 마음을 다스릴 힘이 있다. 이를 깨달으면 곧 힘을 얻는다." — 마르쿠스 아우렐리우스' },
  { en: '"Very little is needed to make a happy life; it is all within yourself, in your way of thinking." — Marcus Aurelius', ko: '"행복한 삶에는 아주 적은 것만 필요하다. 그것은 모두 당신의 생각 안에 있다." — 마르쿠스 아우렐리우스' },
  { en: '"Simplicity is the ultimate sophistication." — Leonardo da Vinci', ko: '"단순함이야말로 궁극의 세련됨이다." — 레오나르도 다빈치' },
  { en: '"Nature does not hurry, yet everything is accomplished." — Lao Tzu', ko: '"자연은 서두르지 않지만, 모든 것을 이루어낸다." — 노자' },
  { en: '"When you let go of what you are, you become what you might be." — Lao Tzu', ko: '"지금의 나를 놓아줄 때, 비로소 될 수 있는 나가 된다." — 노자' },
  { en: '"An empty lantern provides no light. Self-care is the fuel that allows your light to shine brightly." — unknown', ko: '"빈 등불은 빛을 낼 수 없다. 자기 돌봄은 그 빛을 밝게 유지해주는 연료다." — 작자 미상' },
  { en: '"Sometimes the most productive thing you can do is relax." — Mark Black', ko: '"때로는 쉬는 것이 가장 생산적인 일이다." — 마크 블랙' },
  { en: '"Take rest; a field that has rested gives a bountiful crop." — Ovid', ko: '"쉬게 하라. 쉬어본 땅이 풍성한 수확을 낸다." — 오비디우스' },
  { en: '"There is virtue in work and there is virtue in rest. Use both and overlook neither." — Alan Cohen', ko: '"일에도 미덕이 있고 쉼에도 미덕이 있다. 둘 다 쓰고, 어느 것도 소홀히 하지 말라." — 앨런 코헨' },
  { en: '"Almost everything works again if you unplug it for a few minutes." — Anne Lamott', ko: '"잠깐 코드를 뽑아두면 거의 모든 게 다시 잘 작동한다." — 앤 라모트' },
  { en: '"The soul usually knows what to do to heal itself. The challenge is to silence the mind." — Caroline Myss', ko: '"영혼은 대개 스스로를 치유하는 법을 알고 있다. 어려운 건 마음을 조용히 시키는 일이다." — 캐롤라인 미스' },
  { en: '"Within you, there is a stillness and a sanctuary to which you can retreat at any time." — Hermann Hesse', ko: '"당신 안에는 언제든 물러설 수 있는 고요함과 안식처가 있다." — 헤르만 헤세' },
  { en: '"Wherever you are, be all there." — Jim Elliot', ko: '"어디에 있든, 온전히 그곳에 있으라." — 짐 엘리엇' },
  { en: '"The best way to capture moments is to pay attention. This is how we cultivate mindfulness." — Jon Kabat-Zinn', ko: '"순간을 붙잡는 가장 좋은 방법은 주의를 기울이는 것이다. 그것이 곧 마음챙김을 키우는 길이다." — 존 카밧진' },
  { en: '"You are not a drop in the ocean. You are the entire ocean in a drop." — Rumi', ko: '"당신은 바다 속 한 방울이 아니라, 한 방울 안의 온전한 바다다." — 루미' },
  { en: '"The quieter you become, the more you are able to hear." — Rumi', ko: '"조용해질수록, 더 많이 들을 수 있다." — 루미' },
  { en: '"Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself." — Rumi', ko: '"어제는 똑똑해서 세상을 바꾸고 싶었다. 오늘은 지혜로워져서 나 자신을 바꾸고 있다." — 루미' },
  { en: '"Between stimulus and response there is a space. In that space is our power to choose our response." — Viktor Frankl', ko: '"자극과 반응 사이에는 공간이 있다. 그 공간 안에 우리의 반응을 선택할 힘이 있다." — 빅터 프랭클' },
  { en: '"What day is it?" "It\'s today," squeaked Piglet. "My favorite day," said Pooh.', ko: '"오늘이 무슨 요일이야?" 피글렛이 물었다. "오늘이야." "내가 제일 좋아하는 요일이네." 곰돌이 푸가 말했다.' },
  { en: '"Doing nothing often leads to the very best of something." — Winnie the Pooh', ko: '"아무것도 안 하는 게 종종 뭔가 가장 좋은 것으로 이어지곤 하지." — 곰돌이 푸' },
  { en: '"Sometimes I sits and thinks, and sometimes I just sits." — Winnie the Pooh', ko: '"가끔은 앉아서 생각하고, 가끔은 그냥 앉아 있어." — 곰돌이 푸' },
  { en: '"How lucky I am to have something that makes saying goodbye so hard." — Winnie the Pooh (attributed)', ko: '"작별이 이토록 힘들 만큼 소중한 걸 가졌다니, 나는 참 운이 좋다." — 곰돌이 푸(로 알려짐)' },
  { en: '"Not all those who wander are lost." — J. R. R. Tolkien', ko: '"방황하는 이들이 모두 길을 잃은 것은 아니다." — J. R. R. 톨킨' },
  { en: '"It is good to have an end to journey toward, but it is the journey that matters in the end." — Ursula K. Le Guin', ko: '"향해 갈 목적지가 있는 것은 좋지만, 결국 중요한 건 그 여정이다." — 어슐러 K. 르 귄' },
  { en: '"Life moves pretty fast. If you don\'t stop and look around once in a while, you could miss it." — Ferris Bueller\'s Day Off', ko: '"인생은 꽤 빨리 지나간다. 가끔 멈춰서 둘러보지 않으면 놓쳐버릴 수도 있다." — 페리스의 해방일지' },
  { en: '"Almost anything is easier to get into than out of." — Agnes Allen', ko: '"거의 모든 건 들어가기는 쉬워도 빠져나오기는 어렵다." — 애그니스 앨런' },
  { en: '"The trouble is, you think you have time." — Buddha (attributed)', ko: '"문제는, 당신에게 시간이 있다고 착각한다는 것이다." — 붓다(로 알려짐)' },
  { en: '"Realize deeply that the present moment is all you ever have." — Eckhart Tolle', ko: '"지금 이 순간이야말로 당신이 가진 전부라는 사실을 깊이 깨달아라." — 에크하르트 톨레' },
  { en: '"Some people are so poor, all they have is money." — Bob Marley (attributed)', ko: '"어떤 사람들은 너무 가난해서 가진 게 돈밖에 없다." — 밥 말리(로 알려짐)' },
  { en: '"Happiness is not something ready-made. It comes from your own actions." — Dalai Lama', ko: '"행복은 이미 만들어져 있는 게 아니다. 그것은 나의 행동에서 비롯된다." — 달라이 라마' },
  { en: '"A calm mind brings inner strength and self-confidence." — Dalai Lama', ko: '"고요한 마음이 내면의 힘과 자신감을 가져다준다." — 달라이 라마' },
  { en: '"Wrinkles should merely indicate where smiles have been." — Mark Twain', ko: '"주름살은 그저 웃음이 지나간 자리를 표시할 뿐이다." — 마크 트웨인' },
  { en: '"Twenty years from now you will be more disappointed by the things you didn\'t do than by the ones you did do." — Mark Twain', ko: '"20년 후, 당신은 저질렀던 일보다 저지르지 않은 일 때문에 더 후회할 것이다." — 마크 트웨인' },
  { en: '"Comparison is the thief of joy." — Theodore Roosevelt', ko: '"비교는 기쁨을 훔쳐가는 도둑이다." — 시어도어 루스벨트' },
  { en: '"To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment." — Ralph Waldo Emerson', ko: '"끊임없이 다른 무언가가 되라고 강요하는 세상에서 나 자신으로 있는 것, 그것이 가장 큰 성취다." — 랄프 왈도 에머슨' },
  { en: '"Adopt the pace of nature: her secret is patience." — Ralph Waldo Emerson', ko: '"자연의 속도를 따르라. 그 비밀은 인내다." — 랄프 왈도 에머슨' },
  { en: '"Nothing can bring you peace but yourself." — Ralph Waldo Emerson', ko: '"나 자신 외에는 그 무엇도 내게 평화를 가져다줄 수 없다." — 랄프 왈도 에머슨' },
  { en: '"Simplify, simplify." — Henry David Thoreau', ko: '"단순하게, 단순하게 살라." — 헨리 데이비드 소로' },
  { en: '"It\'s not what you look at that matters, it\'s what you see." — Henry David Thoreau', ko: '"무엇을 바라보느냐가 아니라, 무엇을 보느냐가 중요하다." — 헨리 데이비드 소로' },
  { en: '"None are so busy as the fool and the knave." — Benjamin Franklin', ko: '"바보와 사기꾼만큼 늘 바쁜 사람은 없다." — 벤저민 프랭클린' },
  { en: '"Lost time is never found again." — Benjamin Franklin', ko: '"잃어버린 시간은 다시 찾을 수 없다." — 벤저민 프랭클린' },
  { en: '"The best time to plant a tree was 20 years ago. The second best time is now." — Chinese Proverb', ko: '"나무를 심기 가장 좋은 때는 20년 전이었다. 두 번째로 좋은 때는 바로 지금이다." — 중국 속담' },
  { en: '"A journey of a thousand miles begins with a single step." — Lao Tzu', ko: '"천 리 길도 한 걸음부터." — 노자' },
  { en: '"Almost everyone comes to realize that the greatest joys of life are the simplest." — Sylvia Plath (paraphrased sentiment)', ko: '"결국 사람들은 삶의 가장 큰 기쁨이 가장 단순한 것에 있다는 걸 깨닫게 된다." — 실비아 플라스(의 정서를 담아)' },
  { en: '"You are never too old to set another goal or to dream a new dream." — C. S. Lewis', ko: '"새로운 목표를 세우거나 새로운 꿈을 꾸기에 너무 늦은 나이란 없다." — C. S. 루이스' },
  { en: '"Golden advice: eat less, chew more; ride less, walk more; worry less, work more; talk less, think more." — attributed proverb', ko: '"황금률: 덜 먹고 더 씹어라, 덜 타고 더 걸어라, 덜 걱정하고 더 일하라, 덜 말하고 더 생각하라." — 오랜 격언' },
  { en: '"He who has a why to live can bear almost any how." — Friedrich Nietzsche', ko: '"살아야 할 이유가 있는 사람은 그 어떤 방식으로도 견뎌낼 수 있다." — 프리드리히 니체' },
  { en: '"I am not a product of my circumstances. I am a product of my decisions." — Stephen Covey', ko: '"나는 환경의 산물이 아니라, 내 결정의 산물이다." — 스티븐 코비' },
  { en: '"The mind is everything. What you think you become." — Buddha (attributed)', ko: '"마음이 전부다. 생각하는 대로 된다." — 붓다(로 알려짐)' },
  { en: '"Peace comes from within. Do not seek it without." — Buddha (attributed)', ko: '"평화는 내 안에서 온다. 밖에서 찾으려 하지 말라." — 붓다(로 알려짐)' },
  { en: '"What we think, we become." — Buddha (attributed)', ko: '"생각하는 대로 된다." — 붓다(로 알려짐)' },
  { en: '"Turn your wounds into wisdom." — Oprah Winfrey', ko: '"상처를 지혜로 바꾸라." — 오프라 윈프리' },
  { en: '"You get in life what you have the courage to ask for." — Oprah Winfrey', ko: '"인생에서 얻는 것은 요청할 용기가 있는 만큼이다." — 오프라 윈프리' },
  { en: '"Almost everything will work again if you give it a rest." — modern proverb', ko: '"거의 모든 것은 잠시 쉬게 해주면 다시 잘 작동한다." — 현대 격언' },
  { en: '"There is more to life than increasing its speed." — Mahatma Gandhi', ko: '"삶에는 속도를 높이는 것보다 더 중요한 것이 있다." — 마하트마 간디' },
  { en: '"A man is but the product of his thoughts. What he thinks, he becomes." — Mahatma Gandhi', ko: '"인간은 자기 생각의 산물일 뿐이다. 생각하는 대로 그가 된다." — 마하트마 간디' },
];

// 2026-08-01 사용자 지시("쇼츠는 내일 봐도 되지만 소중한 사람은 지금 만나야 합니다" 같은 문구
// 없냐고) → 곧바로 다시 지적("문구가 너무 교육적이잖아.. 후회하란식으로 담배 광고처럼") — "화면 속
// 것 vs 곁에 있는 것" 대비 구조 자체가, 예시 몇 개를 다듬는 걸로는 못 고치는 근본적인 문제였다
// (부모님 목소리/아이의 오늘/오래된 친구처럼 상실·후회를 자극하는 소재가 대비 구조의 핵심이라
// 가볍게 쓰려 해도 결국 경고 문구 톤이 됨). 카테고리 자체를 폐기 — SPARK_ITEMS/spark 소스 삭제.

// 2026-08-01 사용자 지시 — 손짓/블루투스 리모컨처럼 몰라서 안 쓰는 기능을 자연스럽게 알려주는
// 가이드 문구도 이 로테이션에 섞는다. 설정 화면 안 들어가도 오다가다 보고 배우게.
export const TIP_ITEMS: FlatContent[] = [
  { en: 'Wave your hand toward the camera to skip to the next video — no need to touch the screen', ko: '카메라 쪽으로 손을 훠이 밀어보세요. 화면을 안 만져도 다음 영상으로 넘어가요' },
  { en: 'Any Bluetooth remote works — the volume button doubles as next-video', ko: '블루투스 리모컨은 아무거나 괜찮아요. 볼륨 버튼이 다음 영상 버튼이 돼요' },
  { en: 'Hand-wave works best up close, pushed toward the camera in one smooth motion', ko: '손짓은 카메라 가까이에서, 화면 쪽으로 슥 한 번에 밀어주면 제일 잘 잡혀요' },
  { en: 'Tap the P button for Open App, Shorts HOT, and Favorites — all in one place', ko: 'P 버튼을 누르면 앱 열기, 쇼츠 HOT, 즐겨찾기까지 한 번에 볼 수 있어요' },
  { en: 'Loving a video? Add it to Favorites right from the player', ko: '지금 보는 영상이 마음에 들면, 그 자리에서 바로 즐겨찾기에 추가할 수 있어요' },
  { en: 'Fall asleep watching, and the session ends itself. No need to worry about dozing off', ko: '보다가 잠들면 세션이 알아서 꺼져요. 폰 붙잡고 잘까 봐 걱정 안 해도 돼요' },
  { en: 'Every 20 minutes, a quiet nudge to rest your eyes and neck', ko: '20분마다 조용히 쉬라고 알려드려요. 눈도 목도 쉴 시간이에요' },
  { en: 'Hands-free mode lets you skip videos without lifting a finger', ko: '핸즈프리 모드를 켜두면 손 하나 까딱 안 하고 영상을 넘길 수 있어요' },
  { en: "Remote or gesture too much hassle? Just swipe by hand — you're never required to use either", ko: '리모컨도 손짓도 귀찮으면 그냥 손으로 넘겨도 돼요. 둘 다 억지로 안 써도 됩니다' },
  { en: "Today's limit isn't fixed — change it anytime from Settings", ko: '오늘 목표 시간은 고정이 아니에요. 설정에서 언제든 바꿀 수 있어요' },
  { en: "Shorts HOT collects what's trending right now, sorted by category", ko: 'Shorts HOT엔 요즘 많이 보는 영상들이 카테고리별로 모여 있어요' },
  { en: 'Videos you save to Favorites are waiting for you back in the Focus tab', ko: '즐겨찾기에 저장한 영상은 나중에 집중 탭에서 다시 꺼내볼 수 있어요' },
  { en: 'Ran out of time but need a bit more? Extend Time adds minutes just for today', ko: '시간이 부족한데 조금만 더 필요하면, Extend Time으로 오늘 하루만 늘릴 수 있어요' },
  { en: "Break reminders and daily limits can each be turned off separately if one isn't for you", ko: '휴식 알림이랑 하루 제한, 둘 중 하나만 필요하면 따로 꺼둘 수 있어요' },
  { en: 'The daily streak resets if a day is skipped, but past checkmarks on the weekly calendar stay recorded', ko: '연속 출석은 하루라도 건너뛰면 끊기지만, 지난 요일 체크 표시는 그대로 남아 있어요' },
];
