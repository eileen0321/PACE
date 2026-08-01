package com.pace.backend.repository;

import com.pace.backend.entity.InsightItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InsightItemRepository extends JpaRepository<InsightItem, Long> {
    List<InsightItem> findByCategoryAndActiveTrue(String category);
}
