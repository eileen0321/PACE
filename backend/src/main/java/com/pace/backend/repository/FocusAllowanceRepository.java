package com.pace.backend.repository;

import com.pace.backend.entity.FocusAllowance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Optional;

public interface FocusAllowanceRepository extends JpaRepository<FocusAllowance, Long> {
    Optional<FocusAllowance> findByUserIdAndAllowanceDate(Long userId, LocalDate allowanceDate);

    /**
     * 보관 기간이 지난 행 삭제(FocusAllowanceService.purgeOldRows 참고).
     * deleteBy... 파생 쿼리는 행을 전부 로드한 뒤 하나씩 지우므로, 대량 삭제는 벌크 DELETE로 한다.
     */
    @Modifying
    @Query("DELETE FROM FocusAllowance a WHERE a.allowanceDate < :cutoff")
    int deleteByAllowanceDateBefore(@Param("cutoff") LocalDate cutoff);
}
