package com.pace.backend.repository;

import com.pace.backend.entity.ViewingSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface ViewingSessionRepository extends JpaRepository<ViewingSession, String> {

    List<ViewingSession> findByUserIdAndStartedAtBetweenOrderByStartedAtDesc(
            Long userId, LocalDateTime from, LocalDateTime to);

    List<ViewingSession> findTop20ByUserIdOrderByStartedAtDesc(Long userId);

    @Query("select s from ViewingSession s where s.userId = :userId and s.endedAt is not null")
    List<ViewingSession> findCompletedByUserId(@Param("userId") Long userId);
}
