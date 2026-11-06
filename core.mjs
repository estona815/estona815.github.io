/**
 * Quiz logic shared by the browser and Node's built-in test runner.
 * Every public operation is pure: neither the source bank nor its options mutate.
 */
export const EXAM_SIZE = 20;
export const CATEGORIES = Object.freeze(["캐릭터", "세계관", "작품"]);
const QUOTAS = Object.freeze({ 1: 8, 2: 8, 3: 4 });

const GRADES = Object.freeze([
  Object.freeze({ key: "sprout", title: "막 입덕한 새싹", message: "오늘부터 알아가면 되지! 귀여운 모험은 이제 시작이야.", color: "#63856a" }),
  Object.freeze({ key: "explorer", title: "몽글몽글 탐험가", message: "좋아하는 마음이 쑥쑥! 새로운 이야기가 기다리고 있어.", color: "#54899a" }),
  Object.freeze({ key: "friend", title: "제법 아는 친구", message: "함께한 시간이 느껴져! 우리, 꽤 친해졌는걸?", color: "#a17c48" }),
  Object.freeze({ key: "fan", title: "반짝반짝 찐팬", message: "작은 디테일까지 알아보는 너, 반짝반짝 빛나는 찐팬이야!", color: "#bd7085" }),
  Object.freeze({ key: "master", title: "덕력 만렙", message: "와아… 이 정도면 덕력 만렙! 친구들에게도 자랑해 봐.", color: "#9470aa" })
]);

function assertQuestion(question, position, knownIds, sourceIds) {
  const label = `문제 ${position + 1}`;
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new Error(`${label}: 문제는 객체여야 합니다.`);
  }
  if (typeof question.id !== "string" || !question.id.trim()) {
    throw new Error(`${label}: 유효한 id가 필요합니다.`);
  }
  if (knownIds.has(question.id)) throw new Error(`${label}: 중복 id '${question.id}'입니다.`);
  knownIds.add(question.id);
  if (typeof question.question !== "string" || !question.question.trim()) {
    throw new Error(`${label}: 질문이 비어 있습니다.`);
  }
  if (!Array.isArray(question.options) || question.options.length !== 4 ||
      question.options.some(option => typeof option !== "string" || !option.trim()) ||
      new Set(question.options.map(option => option.trim())).size !== 4) {
    throw new Error(`${label}: 서로 다른 비어 있지 않은 보기 4개가 필요합니다.`);
  }
  if (!Number.isInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex > 3) {
    throw new Error(`${label}: answerIndex는 0부터 3까지의 정수여야 합니다.`);
  }
  if (![1, 2, 3].includes(question.difficulty)) {
    throw new Error(`${label}: difficulty는 1, 2, 3 중 하나여야 합니다.`);
  }
  if (!CATEGORIES.includes(question.category)) {
    throw new Error(`${label}: 알 수 없는 category입니다.`);
  }
  if (sourceIds && !sourceIds.has(question.sourceId)) {
    throw new Error(`${label}: 연결된 sourceId가 없습니다.`);
  }
}

/** Validate the bank before rendering imported or bundled question data. */
export function validateBank(bank) {
  if (!bank || typeof bank !== "object" || !Array.isArray(bank.questions) || bank.questions.length < EXAM_SIZE) {
    throw new Error(`문제은행에는 최소 ${EXAM_SIZE}개의 문제가 필요합니다.`);
  }
  if (!Array.isArray(bank.sources)) throw new Error("출처 목록 sources가 필요합니다.");
  const sourceIds = new Set();
  for (const source of bank.sources) {
    if (!source || typeof source.id !== "string" || !source.id.trim() || sourceIds.has(source.id)) {
      throw new Error("출처 id는 비어 있지 않은 고유한 문자열이어야 합니다.");
    }
    sourceIds.add(source.id);
  }
  const knownIds = new Set();
  for (const [position, question] of bank.questions.entries()) assertQuestion(question, position, knownIds, sourceIds);
  return bank;
}

/** Copying Fisher–Yates shuffle; injection of rng makes reproducible exams possible. */
export function shuffle(array, rng = Math.random) {
  if (!Array.isArray(array)) throw new TypeError("shuffle에는 배열이 필요합니다.");
  if (typeof rng !== "function") throw new TypeError("rng는 함수여야 합니다.");
  const result = [...array];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = rng();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError("rng는 0 이상 1 미만의 수를 반환해야 합니다.");
    }
    const target = Math.floor(random * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Select 8 easy, 8 medium, 4 hard; backfill shortages without repeating IDs. */
export function generateExam(questions, rng = Math.random) {
  if (!Array.isArray(questions) || questions.length < EXAM_SIZE) {
    throw new Error(`시험 생성에는 최소 ${EXAM_SIZE}개의 문제가 필요합니다.`);
  }
  const knownIds = new Set();
  for (const [position, question] of questions.entries()) assertQuestion(question, position, knownIds);
  const pool = shuffle(questions, rng);
  const selected = [];
  const selectedIds = new Set();
  for (const difficulty of [1, 2, 3]) {
    for (const question of pool.filter(item => item.difficulty === difficulty).slice(0, QUOTAS[difficulty])) {
      selected.push(question);
      selectedIds.add(question.id);
    }
  }
  if (selected.length < EXAM_SIZE) {
    selected.push(...shuffle(pool.filter(question => !selectedIds.has(question.id)), rng).slice(0, EXAM_SIZE - selected.length));
  }
  return shuffle(selected, rng).map(question => {
    const options = shuffle(question.options.map((text, originalIndex) => ({ text, originalIndex })), rng);
    return {
      ...question,
      options: options.map(option => option.text),
      answerIndex: options.findIndex(option => option.originalIndex === question.answerIndex)
    };
  });
}

/** Grades are based on the number correct in the standard 20-question exam. */
export function gradeFor(correct) {
  if (!Number.isInteger(correct) || correct < 0 || correct > EXAM_SIZE) {
    throw new RangeError("정답 수는 0부터 20까지의 정수여야 합니다.");
  }
  const index = correct <= 4 ? 0 : correct <= 9 ? 1 : correct <= 13 ? 2 : correct <= 17 ? 3 : 4;
  return { ...GRADES[index] };
}

/** Missing answers count as unanswered/incorrect; submitting all answers is a UI gate. */
export function gradeExam(exam, answers = []) {
  if (!Array.isArray(exam) || exam.length < 1 || exam.length > EXAM_SIZE) {
    throw new Error("채점할 시험은 1개 이상 20개 이하의 문제 배열이어야 합니다.");
  }
  if (!Array.isArray(answers)) throw new TypeError("답안은 배열이어야 합니다.");
  const knownIds = new Set();
  for (const [position, question] of exam.entries()) assertQuestion(question, position, knownIds);
  const categories = CATEGORIES.map(name => ({ name, correct: 0, total: 0 }));
  const review = exam.map((question, index) => {
    const selectedIndex = answers[index] == null ? null : answers[index];
    if (selectedIndex !== null && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3)) {
      throw new Error(`답안 ${index + 1}: 보기는 0부터 3까지의 정수 또는 null이어야 합니다.`);
    }
    const correct = selectedIndex !== null && selectedIndex === question.answerIndex;
    const category = categories.find(item => item.name === question.category);
    category.total += 1;
    category.correct += Number(correct);
    return { question, selectedIndex, correct };
  });
  const correct = review.reduce((count, item) => count + Number(item.correct), 0);
  return {
    score: Math.round(correct / exam.length * 100),
    correct,
    total: exam.length,
    grade: gradeFor(correct),
    categories,
    review
  };
}
