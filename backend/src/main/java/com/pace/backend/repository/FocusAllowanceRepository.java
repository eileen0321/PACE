package com.pace.backend.repository;

import com.pace.backend.entity.FocusAllowance;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Optional;

public interface FocusAllowanceRepository extends JpaRepository<FocusAllowance, Long> {
    Optional<FocusAllowance> findByUserIdAndAllowanceDate(Long userId, LocalDate allowanceDate);
}
