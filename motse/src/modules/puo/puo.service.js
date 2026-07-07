'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Puo — courses, lesson derivation, teacher marketplace, correction
 * threads (doc §3.2, §7.2).
 *
 * P5: a lesson is a *derivation* of a canonical heritage item, never a
 * copy — it references the source item and inherits its restrictions.
 * A teacher's audio correction triggers a payout posting on the same
 * rails as every other payout (§9.3).
 */
class PuoService {
  constructor({ store, clock, identity, heritage, ledger, bus, audit }) {
    this.courses = store.collection('courses');
    this.lessons = store.collection('lessons');
    this.threads = store.collection('correction_threads');
    this.progress = store.collection('lesson_progress');
    this.clock = clock;
    this.identity = identity;
    this.heritage = heritage;
    this.ledger = ledger;
    this.bus = bus;
    this.audit = audit;

    bus.register('puo.correction.paid', 1, ['thread_id', 'teacher_ref', 'amount_minor']);
  }

  createCourse(teacherRef, { title, language, level }) {
    this.identity.requireLevel(teacherRef, 'L2');
    return this.courses.insert({
      id: id('crs'),
      teacher_ref: teacherRef,
      title,
      language,
      level,
      lesson_refs: [],
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * Derive a lesson from a heritage item (P5: written once, served
   * everywhere by derivation). Fails closed on restricted sources: the
   * deriving teacher must pass the same membership gate as any reader,
   * and the lesson inherits the source's visibility.
   */
  deriveLesson(courseId, teacherRef, { sourceItemRef, level }) {
    const course = this.courses.get(courseId);
    if (!course) throw err('NOT_FOUND', `No course ${courseId}`);
    if (course.teacher_ref !== teacherRef) {
      throw err('PERMISSION_DENIED', 'Only the course teacher derives lessons');
    }
    // Read-path enforcement — throws MEMBERSHIP_REQUIRED if restricted.
    const source = this.heritage.read(sourceItemRef, teacherRef);
    const lesson = this.lessons.insert({
      id: id('lsn'),
      course_ref: courseId,
      source_item_ref: sourceItemRef, // reference, not a copy
      visibility: source.visibility, // restriction is inherited
      morafe_ref: source.morafe_ref,
      level,
      created_at: this.clock.nowIso(),
    });
    this.courses.update(courseId, { lesson_refs: [...course.lesson_refs, lesson.id] });
    return lesson;
  }

  /** Lesson read path re-checks the SOURCE item — restriction follows it. */
  readLesson(lessonId, readerRef) {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) throw err('NOT_FOUND', `No lesson ${lessonId}`);
    this.heritage.read(lesson.source_item_ref, readerRef); // may throw MEMBERSHIP_REQUIRED
    return lesson;
  }

  // ── Progress tracking (Phase 2) ────────────────────────────────────

  /** Completion respects the lesson's read gate (restricted sources). */
  markLessonComplete(lessonId, learnerRef) {
    this.readLesson(lessonId, learnerRef); // throws MEMBERSHIP_REQUIRED if gated
    const existing = this.progress.findOne(
      (p) => p.lesson_ref === lessonId && p.learner_ref === learnerRef
    );
    if (existing) return existing; // idempotent completion
    return this.progress.insert({
      id: id('prg'),
      lesson_ref: lessonId,
      learner_ref: learnerRef,
      completed_at: this.clock.nowIso(),
    });
  }

  progressFor(learnerRef) {
    const completed = this.progress.find((p) => p.learner_ref === learnerRef);
    const byCourse = {};
    for (const record of completed) {
      const lesson = this.lessons.get(record.lesson_ref);
      if (!lesson) continue;
      const course = this.courses.get(lesson.course_ref);
      if (!course) continue;
      if (!byCourse[course.id]) {
        byCourse[course.id] = { title: course.title, completed: 0, total: course.lesson_refs.length };
      }
      byCourse[course.id].completed += 1;
    }
    return { completed_lessons: completed.length, by_course: byCourse };
  }

  listCourses() {
    return this.courses.find();
  }

  // ── Correction threads (§7.2) ──────────────────────────────────────

  openThread(lessonId, learnerRef, { teacherRef, learnerAudioRef, priceMinor }) {
    this.identity.requireLevel(learnerRef, 'L1');
    const lesson = this.lessons.get(lessonId);
    if (!lesson) throw err('NOT_FOUND', `No lesson ${lessonId}`);
    return this.threads.insert({
      id: id('thr'),
      lesson_ref: lessonId,
      learner_ref: learnerRef,
      teacher_ref: teacherRef,
      audio_refs: [{ by: learnerRef, ref: learnerAudioRef }],
      price_minor: priceMinor,
      state: 'awaiting_teacher',
      payout_ref: null,
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * POST /v1/puo/threads/{id}/corrections — the teacher's audio reply
   * triggers the payout posting: learner wallet → teacher wallet, on
   * the shared payout rails.
   */
  submitCorrection(threadId, teacherRef, { teacherAudioRef, learnerAccountId, teacherAccountId, idempotencyKey }) {
    const thread = this.threads.get(threadId);
    if (!thread) throw err('NOT_FOUND', `No thread ${threadId}`);
    if (thread.teacher_ref !== teacherRef) {
      throw err('PERMISSION_DENIED', 'Only the assigned teacher replies');
    }
    if (thread.state !== 'awaiting_teacher') {
      throw err('STATE_CONFLICT', `Thread is ${thread.state}`);
    }
    const posting = this.ledger.transfer({
      source: learnerAccountId,
      dest: teacherAccountId,
      amountMinor: thread.price_minor,
      purpose: 'puo_correction_payout',
      ref: `thread:${threadId}`,
      idempotencyKey,
      actorRef: teacherRef,
    });
    const updated = this.threads.update(threadId, {
      audio_refs: [...thread.audio_refs, { by: teacherRef, ref: teacherAudioRef }],
      state: 'corrected',
      payout_ref: posting.id,
    });
    this.audit.append(teacherRef, 'puo.correction_paid', `thread:${threadId}`, null, {
      amount_minor: thread.price_minor,
      posting_id: posting.id,
    });
    this.bus.publish('puo.correction.paid', {
      thread_id: threadId,
      teacher_ref: teacherRef,
      amount_minor: thread.price_minor,
    });
    return updated;
  }
}

module.exports = { PuoService };
